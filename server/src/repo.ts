import { randomBytes } from "node:crypto";
import { getPool, withTransaction } from "./db";
import { tierFor, type BadgeTier } from "./badges";
import type {
  Playlist,
  PlaylistVisibility,
  SharedPlaylist,
  SharedTrack,
  Track,
} from "./types";

/**
 * Upsert the account and hand back the handle it holds, if any.
 *
 * The handle comes back from the same statement that touches the row because
 * every caller that creates a session immediately needs to know whether this
 * person has chosen a name yet, and a second query to learn it would be a
 * round trip for a column already under the cursor.
 *
 * The listening switch rides along for the same reason and at the same price —
 * a subquery on a primary key — rather than becoming a settings endpoint the
 * app would have to call before it could draw a switch. Absent means off:
 * somebody who has never touched it has no listen_status row at all.
 */
export async function ensureUser(
  telegramUserId: number,
  username: string | undefined
): Promise<{ handle: string | null; listeningPublic: boolean }> {
  const { rows } = await getPool().query<{
    handle: string | null;
    listening_public: boolean;
  }>(
    `INSERT INTO users (telegram_user_id, username)
     VALUES ($1, $2)
     ON CONFLICT (telegram_user_id)
     DO UPDATE SET username = EXCLUDED.username
     RETURNING handle,
       COALESCE((SELECT ls.is_public FROM listen_status ls
                 WHERE ls.telegram_user_id = users.telegram_user_id), false)
         AS listening_public`,
    [telegramUserId, username ?? null]
  );
  return {
    handle: rows[0]?.handle ?? null,
    listeningPublic: rows[0]?.listening_public ?? false,
  };
}

export interface NewTrack {
  id: string;
  ownerTelegramId: number;
  title: string | null;
  artist: string | null;
  album: string | null;
  durationSeconds: number | null;
  telegramFileId: string;
  mimeType: string | null;
  coverImage: Buffer | null;
  coverMimeType: string | null;
  /**
   * The cover as it lives in the cover channel. Set instead of the two above
   * whenever the artwork made it out there, which is the normal case; the
   * inline pair is what remains when the channel is unset or unreachable.
   */
  coverFileId: string | null;
  /**
   * Who first brought this track into Navaar. Defaults to the owner on a fresh
   * ingest; the save path passes the source's value through instead, so a copy
   * of a copy still credits the person at the head of the chain.
   */
  originAdderId: number | null;
}

/**
 * A track has artwork if it is held either way round.
 *
 * Covers used to live only in cover_image, and now normally live as a file_id
 * pointing at a photo in the cover channel — but not always, and not yet for
 * everything. Both are real answers to "does this track have a picture", and
 * spelling the pair out in one constant is what stops a future query from
 * asking only one of them and hiding half the library's artwork.
 */
const HAS_COVER = `(cover_image IS NOT NULL OR cover_file_id IS NOT NULL)`;
const HAS_COVER_T = `(t.cover_image IS NOT NULL OR t.cover_file_id IS NOT NULL)`;

// Excludes cover_image so list/get/update calls never pull cover bytes over
// the wire; the dedicated cover route/query below fetches those on demand.
const TRACK_COLUMNS = `
  id, owner_telegram_id, title, artist, album, duration_seconds,
  telegram_file_id, mime_type, ${HAS_COVER} AS has_cover,
  origin_adder_id, favorited_at, (lyrics IS NOT NULL) AS has_lyrics, created_at
`;

// The same list, qualified, for the queries that join tracks to something else.
const TRACK_COLUMNS_T = `
  t.id, t.owner_telegram_id, t.title, t.artist, t.album, t.duration_seconds,
  t.telegram_file_id, t.mime_type, ${HAS_COVER_T} AS has_cover,
  t.origin_adder_id, t.favorited_at, (t.lyrics IS NOT NULL) AS has_lyrics,
  t.created_at
`;

/**
 * Deletion is soft, so every read has to exclude the tombstones. Keeping the
 * predicate in one constant is what stops a future query from silently
 * resurrecting deleted tracks.
 */
const LIVE = `deleted_at IS NULL`;
const LIVE_T = `t.deleted_at IS NULL`;

/**
 * Whether one person is visible to another at all: themselves, an accepted
 * friend, or somebody they share a group chat with. Nothing outside that shows
 * a name — not in a credit line, not in an activity row, not in a profile.
 *
 * Takes the parameter placeholders rather than values because it is spliced
 * into larger queries; both arguments must be placeholders or column
 * references, never anything derived from a request body.
 */
function canSeePerson(viewer: string, other: string): string {
  return `(
    ${other} = ${viewer}
    OR EXISTS (
      SELECT 1 FROM friendships f
      WHERE f.status = 'accepted'
        AND ((f.requester_id = ${viewer} AND f.addressee_id = ${other})
          OR (f.requester_id = ${other} AND f.addressee_id = ${viewer}))
    )
    OR EXISTS (
      SELECT 1 FROM group_members gv
      JOIN group_members go ON go.group_chat_id = gv.group_chat_id
      WHERE gv.telegram_user_id = ${viewer} AND go.telegram_user_id = ${other}
    )
  )`;
}

/** How long a soft-deleted track stays restorable before it is swept. */
const UNDO_WINDOW_DAYS = 30;

/**
 * There are three ways a track gets inserted — a plain add, a batch session,
 * and a group crate — and they differ only in what happens around the insert.
 * The statement itself is written once so the column list, the placeholders and
 * the origin fallback cannot drift apart between them.
 *
 * The cast on $11 is load-bearing. $2 is deduced as bigint from its VALUES
 * slot, but inside COALESCE both arguments arrive untyped, and an all-unknown
 * COALESCE resolves to text — which deduces $2 as text a second time and makes
 * Postgres reject the whole statement with 42P08. Typing $11 gives COALESCE a
 * type to agree with, so both deductions land on bigint.
 */
const INSERT_TRACK_SQL = `
  INSERT INTO tracks
    (id, owner_telegram_id, title, artist, album, duration_seconds, telegram_file_id,
     mime_type, cover_image, cover_mime_type, origin_adder_id, cover_file_id)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11::BIGINT, $2), $12)
  RETURNING ${TRACK_COLUMNS}
`;

/** Album is passed separately because a batch session can override it. */
function insertTrackParams(input: NewTrack, album: string | null): unknown[] {
  return [
    input.id,
    input.ownerTelegramId,
    input.title,
    input.artist,
    album,
    input.durationSeconds,
    input.telegramFileId,
    input.mimeType,
    input.coverImage,
    input.coverMimeType,
    input.originAdderId,
    input.coverFileId,
  ];
}

/**
 * Appends a track to the end of a playlist, recording who put it there.
 * Ownership is the caller's problem: every caller of this either owns both rows
 * already or is a group crate, where the contributor is deliberately not the
 * owner. Returns the position taken, or nothing if the track was already there.
 */
const APPEND_PLAYLIST_TRACK_SQL = `
  INSERT INTO playlist_tracks (playlist_id, track_id, position, added_by_telegram_id)
  VALUES (
    $1, $2,
    (SELECT COALESCE(MAX(position), -1) + 1 FROM playlist_tracks WHERE playlist_id = $1),
    $3
  )
  ON CONFLICT (playlist_id, track_id) DO NOTHING
  RETURNING position
`;

export async function createTrack(input: NewTrack): Promise<Track> {
  const { rows } = await getPool().query<Track>(
    INSERT_TRACK_SQL,
    insertTrackParams(input, input.album)
  );
  return rows[0];
}

export type TrackFilter = "all" | "unsorted";

/**
 * The caller's own tracks, each carrying the credit line for where they got it
 * — resolved in the same query rather than a lookup per row, and blanked when
 * the caller has no relationship with the person who would be named.
 */
export async function listTracks(
  ownerTelegramId: number,
  filter: TrackFilter = "all"
): Promise<Track[]> {
  const visible = canSeePerson("$1", "ts.origin_id");
  const { rows } = await getPool().query<Track>(
    `SELECT ${TRACK_COLUMNS_T},
       CASE WHEN ${visible} THEN ts.origin_id END AS credit_user_id,
       CASE WHEN ${visible} THEN COALESCE(ou.handle, ou.username) END AS credit_username,
       EXISTS (SELECT 1 FROM playlist_tracks pt WHERE pt.track_id = t.id) AS in_playlist
     FROM tracks t
     LEFT JOIN track_saves ts ON ts.saved_track_id = t.id AND ts.saver_id = $1
     LEFT JOIN users ou ON ou.telegram_user_id = ts.origin_id
     WHERE t.owner_telegram_id = $1 AND ${LIVE_T}
       AND ($2 = 'all' OR NOT EXISTS (
         SELECT 1 FROM playlist_tracks pt WHERE pt.track_id = t.id
       ))
     ORDER BY t.created_at DESC`,
    [ownerTelegramId, filter]
  );
  return rows;
}

/**
 * The owner-scoped lookup. Every mutation path goes through this one, and it
 * must not grow a "but also if they can see it" mode — reads use the
 * separately named getTrackForListener instead.
 */
export async function getTrack(
  id: string,
  ownerTelegramId: number
): Promise<Track | null> {
  const { rows } = await getPool().query<Track>(
    `SELECT ${TRACK_COLUMNS} FROM tracks
     WHERE id = $1 AND owner_telegram_id = $2 AND ${LIVE}`,
    [id, ownerTelegramId]
  );
  return rows[0] ?? null;
}

/**
 * True when a and b have an accepted friendship, in whichever direction it was
 * originally requested. A friendship is stored once, so every check has to
 * consider both orientations.
 */
export async function areFriends(a: number, b: number): Promise<boolean> {
  const { rows } = await getPool().query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM friendships
       WHERE status = 'accepted'
         AND ((requester_id = $1 AND addressee_id = $2)
           OR (requester_id = $2 AND addressee_id = $1))
     ) AS ok`,
    [a, b]
  );
  return rows[0]?.ok ?? false;
}

/**
 * Whether a requester may have this track at all.
 *
 * Four ways in, and no fifth: they own it, it is in a link-shared playlist, it
 * is in a playlist an accepted friend opened up, or it is in a group crate for
 * a chat they have been seen in. All four are one expression so that a
 * partially-evaluated chain of application-code checks can never leak a track
 * the last check would have refused — and so the read path and the save path
 * cannot drift into two different answers to the same question. Both arguments
 * must be placeholders or column references.
 */
function trackVisibleTo(viewer: string, track: string): string {
  return `(
    ${track}.owner_telegram_id = ${viewer}
    OR EXISTS (
      SELECT 1
      FROM playlist_tracks pt
      JOIN playlists p ON p.id = pt.playlist_id
      WHERE pt.track_id = ${track}.id
        AND (
          -- Anyone holding the link.
          p.visibility = 'public'

          -- A playlist an accepted friend opened up.
          OR (
            p.visibility IN ('friends', 'public')
            AND EXISTS (
              SELECT 1 FROM friendships f
              WHERE f.status = 'accepted'
                AND ((f.requester_id = ${viewer} AND f.addressee_id = p.owner_telegram_id)
                  OR (f.requester_id = p.owner_telegram_id AND f.addressee_id = ${viewer}))
            )
          )

          -- A group playlist for a chat the requester has been seen in.
          OR (
            p.group_chat_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM group_members gm
              WHERE gm.group_chat_id = p.group_chat_id
                AND gm.telegram_user_id = ${viewer}
            )
          )
        )
    )
  )`;
}

/**
 * The listener-scoped lookup, for read paths only. Deliberately a different
 * name from getTrack rather than a flag on it: a boolean argument is easy to
 * pass the wrong way round on a mutation route, a second function name is not.
 */
export async function getTrackForListener(
  id: string,
  requesterTelegramId: number
): Promise<Track | null> {
  const { rows } = await getPool().query<Track>(
    `SELECT ${TRACK_COLUMNS_T}
     FROM tracks t
     WHERE t.id = $1 AND ${LIVE_T} AND ${trackVisibleTo("$2", "t")}`,
    [id, requesterTelegramId]
  );
  return rows[0] ?? null;
}

export interface SavedTrack {
  track: Track;
  /**
   * True when this source had already been saved and the copy that came back
   * is the one made then. The route answers 200 rather than 201 for it, and the
   * app says so instead of pretending a second copy appeared.
   */
  already: boolean;
}

/**
 * Saving somebody else's track into your own library.
 *
 * A track in Navaar is metadata plus a Telegram file_id, so this is a row copy
 * and nothing else: no download, no re-upload, not a byte of new storage, and
 * the cover comes along in whichever of its two forms the source holds. The
 * copy is deliberately independent — the saver can retag it freely, and it goes
 * on working when the original owner deletes theirs.
 *
 * `origin_adder_id` is inherited rather than recomputed, so a copy of a copy
 * still credits whoever brought the track into Navaar in the first place, while
 * `track_saves.origin_id` records the nearer fact of who *you* got it from.
 *
 * The whole thing is one statement guarded by the same visibility expression
 * the read path uses, so a track the requester may not have cannot be copied
 * even if the route's own check were removed.
 */
export async function saveTrackToLibrary(
  sourceTrackId: string,
  saverTelegramId: number
): Promise<SavedTrack | null> {
  return withTransaction(async (client) => {
    const live = async (): Promise<Track | null> => {
      const { rows } = await client.query<Track>(
        `SELECT ${TRACK_COLUMNS_T}
         FROM track_saves ts
         JOIN tracks t ON t.id = ts.saved_track_id
         WHERE ts.saver_id = $1 AND ts.source_track_id = $2 AND ${LIVE_T}`,
        [saverTelegramId, sourceTrackId]
      );
      return rows[0] ?? null;
    };

    const existing = await live();
    if (existing) return { track: existing, already: true };

    const copy = await client.query<Track>(
      `INSERT INTO tracks
         (owner_telegram_id, title, artist, album, duration_seconds, telegram_file_id,
          mime_type, cover_image, cover_mime_type, cover_file_id, origin_adder_id)
       SELECT $1::BIGINT, t.title, t.artist, t.album, t.duration_seconds,
              t.telegram_file_id, t.mime_type, t.cover_image, t.cover_mime_type,
              t.cover_file_id, COALESCE(t.origin_adder_id, t.owner_telegram_id)
       FROM tracks t
       WHERE t.id = $2
         AND ${LIVE_T}
         AND t.owner_telegram_id <> $1
         AND ${trackVisibleTo("$1", "t")}
       RETURNING ${TRACK_COLUMNS}`,
      [saverTelegramId, sourceTrackId]
    );
    const track = copy.rows[0];
    if (!track) return null;

    // The claim on the source. A save that lost a race — the same track tapped
    // twice, which on a phone is one gesture — finds the slot taken by a copy
    // that is still alive, and the DO UPDATE declines it; the two statements
    // are inside one transaction, so the loser blocks until the winner commits
    // rather than both deciding the slot was free. A slot whose copy has since
    // been deleted is taken over, because saving something again after throwing
    // it away is a thing people do on purpose.
    const claim = await client.query(
      `INSERT INTO track_saves (saver_id, origin_id, source_track_id, saved_track_id)
       SELECT $1, t.owner_telegram_id, t.id, $3 FROM tracks t WHERE t.id = $2
       ON CONFLICT (saver_id, source_track_id) DO UPDATE
         SET saved_track_id = EXCLUDED.saved_track_id, created_at = now()
         WHERE NOT EXISTS (
           SELECT 1 FROM tracks prev
           WHERE prev.id = track_saves.saved_track_id AND prev.deleted_at IS NULL
         )
       RETURNING saved_track_id`,
      [saverTelegramId, sourceTrackId, track.id]
    );
    if (claim.rowCount === 0) {
      await client.query(`DELETE FROM tracks WHERE id = $1`, [track.id]);
      const winner = await live();
      return winner ? { track: winner, already: true } : null;
    }

    return { track, already: false };
  });
}

/** Tracks whose artwork was never captured — the input to a cover backfill. */
export async function listTracksMissingCover(
  ownerTelegramId: number
): Promise<Pick<Track, "id" | "title" | "artist" | "telegram_file_id">[]> {
  const { rows } = await getPool().query<
    Pick<Track, "id" | "title" | "artist" | "telegram_file_id">
  >(
    `SELECT id, title, artist, telegram_file_id FROM tracks
     WHERE owner_telegram_id = $1 AND NOT ${HAS_COVER} AND ${LIVE}
     ORDER BY created_at DESC`,
    [ownerTelegramId]
  );
  return rows;
}

/**
 * Unscoped for the same reason getTrackCover is: the route establishes
 * visibility first. Kept out of TRACK_COLUMNS because a library listing does
 * not need a few kilobytes of text per row — only the player, for the one
 * track it is showing.
 */
export async function getTrackLyrics(id: string): Promise<string | null> {
  const { rows } = await getPool().query<{ lyrics: string | null }>(
    `SELECT lyrics FROM tracks WHERE id = $1 AND ${LIVE}`,
    [id]
  );
  return rows[0]?.lyrics ?? null;
}

/**
 * Where a cover's bytes are.
 *
 * A cover posted to the cover channel is a file_id and nothing else; one that
 * predates the channel, or that the channel refused, is still held inline. The
 * union rather than a nullable pair because these are alternatives, not
 * degrees: the route serves one or the other, never both.
 */
export type CoverSource =
  | { kind: "bytes"; image: Buffer; mimeType: string | null }
  | { kind: "telegram"; fileId: string };

/**
 * Unscoped on purpose: the caller has already established that it may see this
 * track, via getTrack for its own or getTrackForListener for somebody else's.
 */
export async function getTrackCover(id: string): Promise<CoverSource | null> {
  const { rows } = await getPool().query<{
    cover_image: Buffer | null;
    cover_mime_type: string | null;
    cover_file_id: string | null;
  }>(
    `SELECT cover_image, cover_mime_type, cover_file_id
     FROM tracks WHERE id = $1 AND ${LIVE}`,
    [id]
  );
  const row = rows[0];
  if (!row) return null;
  // The file_id wins where both exist, which is only ever the instant between
  // an offload writing one and the same statement clearing the other.
  if (row.cover_file_id) return { kind: "telegram", fileId: row.cover_file_id };
  if (row.cover_image) {
    return { kind: "bytes", image: row.cover_image, mimeType: row.cover_mime_type };
  }
  return null;
}

/** The picture a playlist carries in its own right, if the owner gave it one. */
export async function getPlaylistCover(id: string): Promise<CoverSource | null> {
  const { rows } = await getPool().query<{ cover_file_id: string | null }>(
    `SELECT cover_file_id FROM playlists WHERE id = $1`,
    [id]
  );
  const fileId = rows[0]?.cover_file_id;
  return fileId ? { kind: "telegram", fileId } : null;
}

export interface TrackFieldUpdate {
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  lyrics?: string | null;
  /** The heart. Sets or clears favorited_at; the timestamp is the server's. */
  favorited?: boolean;
}

/**
 * A field that is absent is left alone; a field that is present and blank is
 * an instruction to clear it. COALESCE cannot express that difference — it
 * wrote the empty string where the edit modal meant NULL — so presence
 * travels as its own parameter.
 */
export async function updateTrackFields(
  id: string,
  ownerTelegramId: number,
  fields: TrackFieldUpdate
): Promise<Track | null> {
  const normalise = (value: string | null | undefined): string | null => {
    if (value === undefined || value === null) return null;
    const trimmed = value.trim();
    return trimmed === "" ? null : trimmed;
  };

  const { rows } = await getPool().query<Track>(
    `UPDATE tracks
     SET title  = CASE WHEN $3  THEN $4::text  ELSE title END,
         artist = CASE WHEN $5  THEN $6::text  ELSE artist END,
         album  = CASE WHEN $7  THEN $8::text  ELSE album END,
         lyrics = CASE WHEN $9  THEN $10::text ELSE lyrics END,
         favorited_at = CASE
           WHEN NOT $11 THEN favorited_at
           WHEN $12 THEN COALESCE(favorited_at, now())
           ELSE NULL
         END
     WHERE id = $1 AND owner_telegram_id = $2 AND ${LIVE}
     RETURNING ${TRACK_COLUMNS}`,
    [
      id,
      ownerTelegramId,
      "title" in fields,
      normalise(fields.title),
      "artist" in fields,
      normalise(fields.artist),
      "album" in fields,
      normalise(fields.album),
      "lyrics" in fields,
      // Lyrics keep their internal whitespace — an LRC file is line-oriented —
      // so only the outer trim of the blank-means-clear rule applies.
      fields.lyrics == null || fields.lyrics.trim() === "" ? null : fields.lyrics,
      "favorited" in fields,
      fields.favorited === true,
    ]
  );
  return rows[0] ?? null;
}

/**
 * Sets a track's artwork, held whichever way the caller managed to store it.
 *
 * Both columns are always written, so setting a cover one way clears the other
 * rather than leaving a stale copy of the previous picture behind it.
 */
export async function updateTrackCover(
  id: string,
  ownerTelegramId: number,
  cover: CoverSource
): Promise<Track | null> {
  const telegram = cover.kind === "telegram";
  const { rows } = await getPool().query<Track>(
    `UPDATE tracks SET cover_image = $3, cover_mime_type = $4, cover_file_id = $5
     WHERE id = $1 AND owner_telegram_id = $2 AND ${LIVE}
     RETURNING ${TRACK_COLUMNS}`,
    [
      id,
      ownerTelegramId,
      telegram ? null : cover.image,
      telegram ? null : cover.mimeType,
      telegram ? cover.fileId : null,
    ]
  );
  return rows[0] ?? null;
}

/**
 * Moves a cover that is still held as bytes out to the cover channel.
 *
 * Unscoped by owner: this is housekeeping over rows the caller has already
 * selected, and it changes where a picture lives rather than what it is.
 */
export async function offloadTrackCover(id: string, fileId: string): Promise<void> {
  await getPool().query(
    `UPDATE tracks SET cover_file_id = $2, cover_image = NULL, cover_mime_type = NULL
     WHERE id = $1`,
    [id, fileId]
  );
}

export interface StoredCover {
  id: string;
  title: string | null;
  artist: string | null;
  cover_image: Buffer;
  cover_mime_type: string | null;
}

/** Covers still sitting in Postgres — the input to an offload run. */
export async function listTracksWithCoverBytes(
  ownerTelegramId: number,
  limit: number
): Promise<StoredCover[]> {
  const { rows } = await getPool().query<StoredCover>(
    `SELECT id, title, artist, cover_image, cover_mime_type FROM tracks
     WHERE owner_telegram_id = $1 AND cover_image IS NOT NULL AND ${LIVE}
     ORDER BY created_at DESC
     LIMIT $2`,
    [ownerTelegramId, limit]
  );
  return rows;
}

/** How many of this owner's covers are still bytes, offloaded or not. */
export async function countTracksWithCoverBytes(
  ownerTelegramId: number
): Promise<number> {
  const { rows } = await getPool().query<{ count: string }>(
    `SELECT COUNT(*) FROM tracks
     WHERE owner_telegram_id = $1 AND cover_image IS NOT NULL AND ${LIVE}`,
    [ownerTelegramId]
  );
  return Number(rows[0]?.count ?? 0);
}

/** Gives a playlist a picture of its own, or clears it when fileId is null. */
export async function updatePlaylistCover(
  id: string,
  ownerTelegramId: number,
  fileId: string | null
): Promise<Playlist | null> {
  const { rowCount } = await getPool().query(
    `UPDATE playlists SET cover_file_id = $3, updated_at = now()
     WHERE id = $1 AND owner_telegram_id = $2`,
    [id, ownerTelegramId, fileId]
  );
  if (!rowCount) return null;
  return getPlaylist(id, ownerTelegramId);
}

/** Marks a track deleted. Reversible for UNDO_WINDOW_DAYS. */
export async function softDeleteTrack(
  id: string,
  ownerTelegramId: number
): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `UPDATE tracks SET deleted_at = now()
     WHERE id = $1 AND owner_telegram_id = $2 AND ${LIVE}`,
    [id, ownerTelegramId]
  );
  return (rowCount ?? 0) > 0;
}

export async function restoreTrack(
  id: string,
  ownerTelegramId: number
): Promise<Track | null> {
  const { rows } = await getPool().query<Track>(
    `UPDATE tracks SET deleted_at = NULL
     WHERE id = $1 AND owner_telegram_id = $2 AND deleted_at IS NOT NULL
     RETURNING ${TRACK_COLUMNS}`,
    [id, ownerTelegramId]
  );
  return rows[0] ?? null;
}

/**
 * Removes tombstones past the undo window for good, along with the playlist
 * rows that cascade off them. Called opportunistically from the ingest path
 * rather than on a schedule: the free tier has no cron, and ingest is the one
 * moment a user is reliably present and not waiting on a render.
 */
export async function purgeExpiredTracks(): Promise<number> {
  const { rowCount } = await getPool().query(
    `DELETE FROM tracks
     WHERE deleted_at IS NOT NULL
       AND deleted_at < now() - make_interval(days => $1)`,
    [UNDO_WINDOW_DAYS]
  );
  return rowCount ?? 0;
}

/**
 * A playlist's own columns, spelled out rather than `p.*` because every read
 * below replaces the stored cover with a resolved one under the same name, and
 * two columns called cover_track_id in one result set is a coin toss.
 */
const PLAYLIST_COLUMNS = `p.id, p.owner_telegram_id, p.name, p.description,
     p.created_at, p.updated_at, p.visibility, p.share_slug, p.group_chat_id,
     (p.cover_file_id IS NOT NULL) AS has_cover`;

/**
 * The picture: whatever the owner pinned, and otherwise the first track in the
 * playlist that carries artwork.
 *
 * Resolving on read rather than storing means a playlist nobody has ever given
 * a cover to still has one, and a playlist whose pinned track was later deleted
 * quietly goes back to choosing for itself instead of showing a blank square.
 *
 * A picture the owner uploaded for the playlist itself outranks both, and is
 * reported by has_cover rather than here: this column names a *track* whose
 * artwork to borrow, and an uploaded playlist cover belongs to no track.
 */
const PLAYLIST_COVER = `COALESCE(
       (SELECT t.id FROM tracks t
        WHERE t.id = p.cover_track_id AND ${LIVE_T} AND ${HAS_COVER_T}),
       (SELECT t.id FROM playlist_tracks pt
        JOIN tracks t ON t.id = pt.track_id
        WHERE pt.playlist_id = p.id AND ${LIVE_T} AND ${HAS_COVER_T}
        ORDER BY pt.position ASC LIMIT 1)
     ) AS cover_track_id`;

const PLAYLIST_TRACK_COUNT = `(SELECT COUNT(*) FROM playlist_tracks pt
        JOIN tracks t ON t.id = pt.track_id
        WHERE pt.playlist_id = p.id AND ${LIVE_T})::int AS track_count`;

export async function createPlaylist(
  ownerTelegramId: number,
  name: string
): Promise<Playlist> {
  const { rows } = await getPool().query<Playlist>(
    `INSERT INTO playlists (owner_telegram_id, name) VALUES ($1, $2) RETURNING *`,
    [ownerTelegramId, name]
  );
  return rows[0];
}

export async function listPlaylists(
  ownerTelegramId: number
): Promise<Playlist[]> {
  const { rows } = await getPool().query<Playlist>(
    `SELECT ${PLAYLIST_COLUMNS},
       ${PLAYLIST_TRACK_COUNT},
       ${PLAYLIST_COVER}
     FROM playlists p
     WHERE p.owner_telegram_id = $1
     ORDER BY p.updated_at DESC`,
    [ownerTelegramId]
  );
  return rows;
}

/**
 * One playlist in the shape every list returns it in. Mutations re-read
 * through this rather than using RETURNING *, so a rename never hands the app
 * a raw null cover and blanks a picture that was only ever computed.
 */
export async function getPlaylist(
  id: string,
  ownerTelegramId: number
): Promise<Playlist | null> {
  const { rows } = await getPool().query<Playlist>(
    `SELECT ${PLAYLIST_COLUMNS},
       ${PLAYLIST_TRACK_COUNT},
       ${PLAYLIST_COVER}
     FROM playlists p
     WHERE p.id = $1 AND p.owner_telegram_id = $2`,
    [id, ownerTelegramId]
  );
  return rows[0] ?? null;
}

/**
 * Change a playlist's name, its description, or both.
 *
 * One function rather than one per field because the two are edited in the same
 * sheet and PATCH is defined as a partial update: a caller who is only
 * rewriting the description should not have to resend the name it did not
 * touch, and an omitted key has to mean "leave it alone" rather than "set it to
 * null". `undefined` is that distinction, which is why the fields are optional
 * here and null is a legal, meaningful value for the description.
 */
export async function updatePlaylist(
  id: string,
  ownerTelegramId: number,
  fields: {
    name?: string;
    description?: string | null;
    visibility?: PlaylistVisibility;
  }
): Promise<Playlist | null> {
  const sets: string[] = [];
  const params: unknown[] = [id, ownerTelegramId];
  if (fields.name !== undefined) {
    params.push(fields.name);
    sets.push(`name = $${params.length}`);
  }
  if (fields.description !== undefined) {
    params.push(fields.description);
    sets.push(`description = $${params.length}`);
  }
  if (fields.visibility !== undefined) {
    // The slug is the credential for the unauthenticated link, so its lifetime
    // is decided here rather than by the caller: going private destroys it,
    // which is what makes "make it private again" an actual revocation, and
    // coming back out of private mints a new one so a link that was revoked
    // can never be resurrected by re-sharing.
    //
    // COALESCE rather than an unconditional assignment, so widening from
    // friends to a link keeps the address people were already given. The
    // candidate below is generated on every call and simply discarded when one
    // already exists — cheaper than a read to decide whether to generate, and
    // it keeps the whole rule inside a single atomic statement.
    params.push(fields.visibility);
    const visibility = `$${params.length}`;
    sets.push(`visibility = ${visibility}`);
    params.push(newShareSlug());
    sets.push(
      `share_slug = CASE WHEN ${visibility} = 'private'
                        THEN NULL
                        ELSE COALESCE(share_slug, $${params.length}) END`
    );
  }
  // Nothing to write is not an error — the caller still wants the row back.
  if (sets.length === 0) return getPlaylist(id, ownerTelegramId);

  const { rowCount } = await getPool().query(
    `UPDATE playlists SET ${sets.join(", ")}, updated_at = now()
     WHERE id = $1 AND owner_telegram_id = $2`,
    params
  );
  if ((rowCount ?? 0) === 0) return null;
  return getPlaylist(id, ownerTelegramId);
}

/**
 * Pin a cover, or pass null to hand the choice back to the playlist.
 *
 * The track has to be one of the playlist's own and has to actually carry
 * artwork — the subquery is the check, so a track id from somebody else's
 * library cannot be pinned by guessing it, and the update simply matches no
 * rows instead of storing something the reader would then have to filter out.
 */
export async function setPlaylistCover(
  id: string,
  ownerTelegramId: number,
  trackId: string | null
): Promise<Playlist | null> {
  const { rowCount } = await getPool().query(
    `UPDATE playlists p SET cover_track_id = $3, updated_at = now()
     WHERE p.id = $1 AND p.owner_telegram_id = $2
       AND ($3::uuid IS NULL OR EXISTS (
         SELECT 1 FROM playlist_tracks pt
         JOIN tracks t ON t.id = pt.track_id
         WHERE pt.playlist_id = p.id AND t.id = $3::uuid
           AND ${LIVE_T} AND t.cover_image IS NOT NULL
       ))`,
    [id, ownerTelegramId, trackId]
  );
  if ((rowCount ?? 0) === 0) return null;
  return getPlaylist(id, ownerTelegramId);
}

export async function deletePlaylist(
  id: string,
  ownerTelegramId: number
): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `DELETE FROM playlists WHERE id = $1 AND owner_telegram_id = $2`,
    [id, ownerTelegramId]
  );
  return (rowCount ?? 0) > 0;
}

/**
 * The visibility predicate, as one SQL fragment.
 *
 * A playlist is readable by a requester when they own it, when its owner has
 * opened it to friends and the two are accepted friends, when it carries a
 * share link, or when it belongs to a group chat the requester has been seen
 * in. It lives in a constant for the same reason LIVE does: the moment two
 * queries write this out by hand, one of them will eventually be missing a
 * clause and hand somebody a playlist they should not see. The fragment reads
 * the playlist as `p`, so every query using it must alias playlists that way,
 * and takes the requester as whichever placeholder the caller passes in.
 */
function playlistVisibleTo(viewerParam: string): string {
  return `(
    p.owner_telegram_id = ${viewerParam}
    OR p.visibility = 'public'
    OR (
      p.visibility IN ('friends', 'public')
      AND EXISTS (
        SELECT 1 FROM friendships f
        WHERE f.status = 'accepted'
          AND ((f.requester_id = ${viewerParam} AND f.addressee_id = p.owner_telegram_id)
            OR (f.requester_id = p.owner_telegram_id AND f.addressee_id = ${viewerParam}))
      )
    )
    OR (
      p.group_chat_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM group_members gm
        WHERE gm.group_chat_id = p.group_chat_id
          AND gm.telegram_user_id = ${viewerParam}
      )
    )
  )`;
}

/**
 * Somebody else's playlists, as far as this requester is allowed to see them.
 *
 * Separately named from listPlaylists rather than a flag on it, following the
 * same rule as getTrackForListener: a mutation route that reaches for the
 * wrong one should fail to compile a sentence, not silently widen a scope.
 */
export async function listPlaylistsVisibleTo(
  ownerTelegramId: number,
  requesterTelegramId: number
): Promise<Playlist[]> {
  const { rows } = await getPool().query<Playlist>(
    `SELECT ${PLAYLIST_COLUMNS},
       ${PLAYLIST_TRACK_COUNT},
       ${PLAYLIST_COVER}
     FROM playlists p
     WHERE p.owner_telegram_id = $1
       AND ${playlistVisibleTo("$2")}
     ORDER BY p.updated_at DESC`,
    [ownerTelegramId, requesterTelegramId]
  );
  return rows;
}

/**
 * The rows of a playlist the requester can see but may not own. Returns an
 * empty list both for an invisible playlist and an empty one; the route
 * establishes visibility first so it can tell the two apart and 404.
 */
export async function listPlaylistTracksForListener(
  playlistId: string,
  requesterTelegramId: number
): Promise<Track[]> {
  const { rows } = await getPool().query<Track>(
    `SELECT ${TRACK_COLUMNS_T}
     FROM playlist_tracks pt
     JOIN tracks t ON t.id = pt.track_id
     JOIN playlists p ON p.id = pt.playlist_id
     WHERE pt.playlist_id = $1 AND ${LIVE_T} AND ${playlistVisibleTo("$2")}
     ORDER BY pt.position ASC`,
    [playlistId, requesterTelegramId]
  );
  return rows;
}

/** Whether this requester may read this playlist at all. */
export async function playlistVisibleToRequester(
  playlistId: string,
  requesterTelegramId: number
): Promise<Playlist | null> {
  const { rows } = await getPool().query<Playlist>(
    `SELECT ${PLAYLIST_COLUMNS},
       ${PLAYLIST_TRACK_COUNT},
       ${PLAYLIST_COVER}
     FROM playlists p
     WHERE p.id = $1 AND ${playlistVisibleTo("$2")}`,
    [playlistId, requesterTelegramId]
  );
  return rows[0] ?? null;
}

/**
 * A fresh share credential.
 *
 * Twelve random bytes as base64url — sixteen characters, no padding, nothing
 * that needs escaping in a URL. It is minted here rather than in a route
 * because it is a secret in the same sense a password is: anyone holding it
 * can stream the playlist forever, so the code that decides what it is should
 * be the code that decides when it lives and dies.
 */
function newShareSlug(): string {
  return randomBytes(12).toString("base64url");
}

/**
 * Replace the share credential.
 *
 * The only way to revoke a link that has already been passed around, which is
 * why it is an explicit action of its own rather than a side effect of editing
 * something else. Refuses on a private playlist: there is no link to revoke,
 * and minting one for a playlist nobody can open would leave a live credential
 * sitting in the row waiting to be shared by accident.
 */
export async function rotatePlaylistSlug(
  id: string,
  ownerTelegramId: number
): Promise<Playlist | null> {
  const { rowCount } = await getPool().query(
    `UPDATE playlists SET share_slug = $3, updated_at = now()
     WHERE id = $1 AND owner_telegram_id = $2 AND visibility <> 'private'`,
    [id, ownerTelegramId, newShareSlug()]
  );
  if ((rowCount ?? 0) === 0) return null;
  return getPlaylist(id, ownerTelegramId);
}

/**
 * What a stranger holding a link is allowed to know about a track.
 *
 * A deliberately short list rather than TRACK_COLUMNS with fields deleted
 * afterwards: the wide one carries owner_telegram_id, origin_adder_id and
 * telegram_file_id, and a projection that has to be trimmed by its caller is
 * one refactor away from not being. Nothing here identifies a person, and the
 * id is only the address the shared stream and cover routes are called with.
 */
const SHARED_TRACK_COLUMNS = `
  t.id, t.title, t.artist, t.album, t.duration_seconds,
  ${HAS_COVER_T} AS has_cover
`;

/**
 * The playlist behind a link, if the link is live.
 *
 * 'public' and nothing else. A slug also exists while a playlist is
 * friends-only — the same address, opened inside Telegram where the friendship
 * is actually checked — so matching on the slug alone here would hand every
 * friends-only playlist to anyone who was ever sent its link.
 */
export async function getSharedPlaylist(
  slug: string
): Promise<SharedPlaylist | null> {
  const { rows } = await getPool().query<SharedPlaylist>(
    `SELECT p.id, p.name, p.description, p.share_slug,
       (p.cover_file_id IS NOT NULL) AS has_cover,
       COALESCE(u.handle, u.username) AS owner_name,
       ${PLAYLIST_TRACK_COUNT},
       ${PLAYLIST_COVER}
     FROM playlists p
     LEFT JOIN users u ON u.telegram_user_id = p.owner_telegram_id
     WHERE p.share_slug = $1 AND p.visibility = 'public'`,
    [slug]
  );
  return rows[0] ?? null;
}

/** The rows of a shared playlist, in order, for a caller with no session. */
export async function listSharedPlaylistTracks(
  slug: string
): Promise<SharedTrack[]> {
  const { rows } = await getPool().query<SharedTrack>(
    `SELECT ${SHARED_TRACK_COLUMNS}
     FROM playlist_tracks pt
     JOIN tracks t ON t.id = pt.track_id
     JOIN playlists p ON p.id = pt.playlist_id
     WHERE p.share_slug = $1 AND p.visibility = 'public' AND ${LIVE_T}
     ORDER BY pt.position ASC`,
    [slug]
  );
  return rows;
}

/**
 * One track of a shared playlist, addressed by the slug it was reached through.
 *
 * The slug and the track id travel together into a single query on purpose.
 * These are the unauthenticated media routes, so a bare track id would make
 * them an open proxy over every track in the database for anyone who holds one
 * shared link and can guess a UUID. The join is the authorization, and there
 * is no other.
 */
export async function getSharedTrack(
  slug: string,
  trackId: string
): Promise<{ id: string; telegram_file_id: string; mime_type: string | null } | null> {
  const { rows } = await getPool().query<{
    id: string;
    telegram_file_id: string;
    mime_type: string | null;
  }>(
    `SELECT t.id, t.telegram_file_id, t.mime_type
     FROM playlist_tracks pt
     JOIN tracks t ON t.id = pt.track_id
     JOIN playlists p ON p.id = pt.playlist_id
     WHERE p.share_slug = $1 AND p.visibility = 'public'
       AND t.id = $2 AND ${LIVE_T}`,
    [slug, trackId]
  );
  return rows[0] ?? null;
}

/** The artwork of one track of a shared playlist, under the same join. */
export async function getSharedTrackCover(
  slug: string,
  trackId: string
): Promise<CoverSource | null> {
  const { rows } = await getPool().query<{
    cover_image: Buffer | null;
    cover_mime_type: string | null;
    cover_file_id: string | null;
  }>(
    `SELECT t.cover_image, t.cover_mime_type, t.cover_file_id
     FROM playlist_tracks pt
     JOIN tracks t ON t.id = pt.track_id
     JOIN playlists p ON p.id = pt.playlist_id
     WHERE p.share_slug = $1 AND p.visibility = 'public'
       AND t.id = $2 AND ${LIVE_T}`,
    [slug, trackId]
  );
  const row = rows[0];
  if (!row) return null;
  if (row.cover_file_id) return { kind: "telegram", fileId: row.cover_file_id };
  if (row.cover_image) {
    return { kind: "bytes", image: row.cover_image, mimeType: row.cover_mime_type };
  }
  return null;
}

/** The shared playlist's own picture, under the same 'public' check. */
export async function getSharedPlaylistCover(
  slug: string
): Promise<CoverSource | null> {
  const { rows } = await getPool().query<{ cover_file_id: string | null }>(
    `SELECT cover_file_id FROM playlists
     WHERE share_slug = $1 AND visibility = 'public'`,
    [slug]
  );
  const fileId = rows[0]?.cover_file_id;
  return fileId ? { kind: "telegram", fileId } : null;
}

export async function addPlaylistTrack(
  playlistId: string,
  trackId: string,
  ownerTelegramId: number
): Promise<boolean> {
  const pool = getPool();

  // Both rows must belong to the caller — verified via the join conditions below,
  // not by trusting the IDs passed in.
  const { rows: ownedRows } = await pool.query(
    `SELECT
       (SELECT 1 FROM playlists WHERE id = $1 AND owner_telegram_id = $3) AS playlist_owned,
       (SELECT 1 FROM tracks WHERE id = $2 AND owner_telegram_id = $3 AND ${LIVE}) AS track_owned`,
    [playlistId, trackId, ownerTelegramId]
  );
  if (!ownedRows[0]?.playlist_owned || !ownedRows[0]?.track_owned) {
    return false;
  }

  const { rows: posRows } = await pool.query<{ next_position: number }>(
    `SELECT COALESCE(MAX(position), -1) + 1 AS next_position
     FROM playlist_tracks WHERE playlist_id = $1`,
    [playlistId]
  );

  await pool.query(
    `INSERT INTO playlist_tracks (playlist_id, track_id, position)
     VALUES ($1, $2, $3)
     ON CONFLICT (playlist_id, track_id) DO NOTHING`,
    [playlistId, trackId, posRows[0].next_position]
  );
  return true;
}

export async function removePlaylistTrack(
  playlistId: string,
  trackId: string,
  ownerTelegramId: number
): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `DELETE FROM playlist_tracks pt
     USING playlists p
     WHERE pt.playlist_id = p.id
       AND p.owner_telegram_id = $3
       AND pt.playlist_id = $1
       AND pt.track_id = $2`,
    [playlistId, trackId, ownerTelegramId]
  );
  return (rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Avatars
// ---------------------------------------------------------------------------

/**
 * Telegram's profile photo for a user, as a file_id. Refreshed on /start rather
 * than per request: getUserProfilePhotos is a Bot API call, and the avatars of
 * everyone in a friends list would otherwise be a fan-out on every screen.
 *
 * NULL is the ordinary answer. Plenty of people have no photo, or hide it from
 * bots, and that is not an error anywhere upstream.
 */
export async function getUserAvatarFileId(telegramUserId: number): Promise<string | null> {
  const { rows } = await getPool().query<{ avatar_file_id: string | null }>(
    `SELECT avatar_file_id FROM users WHERE telegram_user_id = $1`,
    [telegramUserId]
  );
  return rows[0]?.avatar_file_id ?? null;
}

export async function setUserAvatarFileId(
  telegramUserId: number,
  fileId: string | null
): Promise<void> {
  await getPool().query(
    `UPDATE users SET avatar_file_id = $2 WHERE telegram_user_id = $1`,
    [telegramUserId, fileId]
  );
}

// ---------------------------------------------------------------------------
// Derived collections
// ---------------------------------------------------------------------------

export interface DerivedCollection {
  name: string;
  track_count: number;
  /** A track in the collection that has cover art, or null if none does. */
  cover_track_id: string | null;
  /** Albums only: the artist to print beneath the name. */
  artist: string | null;
}

/**
 * Albums and artists are not tables. They are a GROUP BY over the tags on the
 * caller's own tracks, so editing a tag reshapes the view with no migration and
 * no rows to keep in step.
 *
 * Tracks with the tag missing are skipped rather than collected into an
 * "Unknown" bucket: an untagged track belongs in The Crate, where the user can
 * see and fix it, not hidden inside a fake album.
 */
async function listDerived(
  ownerTelegramId: number,
  column: "album" | "artist"
): Promise<DerivedCollection[]> {
  const { rows } = await getPool().query<DerivedCollection>(
    `SELECT t.${column} AS name,
       COUNT(*)::int AS track_count,
       (ARRAY_AGG(t.id ORDER BY t.created_at DESC)
         FILTER (WHERE ${HAS_COVER_T}))[1] AS cover_track_id,
       ${column === "album" ? "MIN(t.artist)" : "NULL::text"} AS artist
     FROM tracks t
     WHERE t.owner_telegram_id = $1 AND ${LIVE_T}
       AND t.${column} IS NOT NULL AND t.${column} <> ''
     GROUP BY t.${column}
     ORDER BY t.${column} ASC`,
    [ownerTelegramId]
  );
  return rows;
}

export function listAlbums(ownerTelegramId: number): Promise<DerivedCollection[]> {
  return listDerived(ownerTelegramId, "album");
}

export function listArtists(ownerTelegramId: number): Promise<DerivedCollection[]> {
  return listDerived(ownerTelegramId, "artist");
}

/** The tracks tagged with one album or artist, in the caller's own library. */
export async function listTracksByTag(
  ownerTelegramId: number,
  column: "album" | "artist",
  value: string
): Promise<Track[]> {
  const { rows } = await getPool().query<Track>(
    `SELECT ${TRACK_COLUMNS_T} FROM tracks t
     WHERE t.owner_telegram_id = $1 AND ${LIVE_T} AND t.${column} = $2
     ORDER BY t.created_at ASC`,
    [ownerTelegramId, value]
  );
  return rows;
}

/**
 * Renaming an album means rewriting the tag on every track that carries it.
 * There is no album row to update, which is the point: one statement, scoped to
 * the owner, and the Albums view reshapes itself on the next read.
 */
export async function renameAlbum(
  ownerTelegramId: number,
  from: string,
  to: string
): Promise<number> {
  const { rowCount } = await getPool().query(
    `UPDATE tracks SET album = $3
     WHERE owner_telegram_id = $1 AND album = $2 AND ${LIVE}`,
    [ownerTelegramId, from, to]
  );
  return rowCount ?? 0;
}

// ---------------------------------------------------------------------------
// Bulk operations
// ---------------------------------------------------------------------------

/**
 * Add a selection to a playlist in one statement. Ownership of both the
 * playlist and every track is a condition of the INSERT rather than a check
 * before it, so a foreign id in the array simply contributes no row.
 *
 * Positions continue from the end of the playlist and follow the order the
 * client sent, which is the order the user selected in.
 */
export async function addPlaylistTracksBulk(
  playlistId: string,
  trackIds: string[],
  ownerTelegramId: number
): Promise<number> {
  if (trackIds.length === 0) return 0;
  const pool = getPool();
  const { rowCount } = await pool.query(
    `INSERT INTO playlist_tracks (playlist_id, track_id, position, added_by_telegram_id)
     SELECT $1, t.id,
       (SELECT COALESCE(MAX(position), -1) FROM playlist_tracks WHERE playlist_id = $1)
         + ROW_NUMBER() OVER (ORDER BY array_position($2::uuid[], t.id)),
       $3
     FROM tracks t
     WHERE t.id = ANY($2::uuid[])
       AND t.owner_telegram_id = $3
       AND ${LIVE_T}
       AND EXISTS (
         SELECT 1 FROM playlists p WHERE p.id = $1 AND p.owner_telegram_id = $3
       )
     ON CONFLICT (playlist_id, track_id) DO NOTHING`,
    [playlistId, trackIds, ownerTelegramId]
  );
  await pool.query(
    `UPDATE playlists SET updated_at = now() WHERE id = $1 AND owner_telegram_id = $2`,
    [playlistId, ownerTelegramId]
  );
  return rowCount ?? 0;
}

/**
 * Soft-delete a selection. Returns the ids that actually moved, which is what
 * the undo snackbar has to put back — not the ids the client asked about.
 */
export async function softDeleteTracksBulk(
  trackIds: string[],
  ownerTelegramId: number
): Promise<string[]> {
  if (trackIds.length === 0) return [];
  const { rows } = await getPool().query<{ id: string }>(
    `UPDATE tracks SET deleted_at = now()
     WHERE id = ANY($1::uuid[]) AND owner_telegram_id = $2 AND ${LIVE}
     RETURNING id`,
    [trackIds, ownerTelegramId]
  );
  return rows.map((row) => row.id);
}

export async function restoreTracksBulk(
  trackIds: string[],
  ownerTelegramId: number
): Promise<number> {
  if (trackIds.length === 0) return 0;
  const { rowCount } = await getPool().query(
    `UPDATE tracks SET deleted_at = NULL
     WHERE id = ANY($1::uuid[]) AND owner_telegram_id = $2 AND deleted_at IS NOT NULL`,
    [trackIds, ownerTelegramId]
  );
  return rowCount ?? 0;
}

export async function removePlaylistTracksBulk(
  playlistId: string,
  trackIds: string[],
  ownerTelegramId: number
): Promise<number> {
  if (trackIds.length === 0) return 0;
  const { rowCount } = await getPool().query(
    `DELETE FROM playlist_tracks pt
     USING playlists p
     WHERE pt.playlist_id = p.id
       AND p.owner_telegram_id = $3
       AND pt.playlist_id = $1
       AND pt.track_id = ANY($2::uuid[])`,
    [playlistId, trackIds, ownerTelegramId]
  );
  return rowCount ?? 0;
}

// ---------------------------------------------------------------------------
// Friendships
// ---------------------------------------------------------------------------

/**
 * One row per pair, stored in the direction the request was first sent, so
 * accepting is a status flip rather than a second row. Every read has to look
 * both ways because of that — see areFriends.
 */
export type FriendRequestOutcome =
  | "self"
  | "already_friends"
  | "already_requested"
  | "accepted"
  | "requested";

export async function requestFriendship(
  requesterId: number,
  addresseeId: number
): Promise<FriendRequestOutcome> {
  if (requesterId === addresseeId) return "self";

  return withTransaction(async (client) => {
    // Locked for the length of the transaction so two people tapping each
    // other's link at the same moment cannot both insert a pending row.
    const { rows } = await client.query<{ requester_id: string; status: string }>(
      `SELECT requester_id, status FROM friendships
       WHERE (requester_id = $1 AND addressee_id = $2)
          OR (requester_id = $2 AND addressee_id = $1)
       FOR UPDATE`,
      [requesterId, addresseeId]
    );

    const existing = rows[0];
    if (existing?.status === "accepted") return "already_friends";

    if (existing) {
      if (Number(existing.requester_id) === requesterId) return "already_requested";
      // They already asked us. Tapping their link is an answer, not a second
      // question, so it completes the handshake instead of queueing beside it.
      await client.query(
        `UPDATE friendships SET status = 'accepted'
         WHERE requester_id = $1 AND addressee_id = $2`,
        [addresseeId, requesterId]
      );
      return "accepted";
    }

    await client.query(
      `INSERT INTO friendships (requester_id, addressee_id, status)
       VALUES ($1, $2, 'pending')`,
      [requesterId, addresseeId]
    );
    return "requested";
  });
}

/** Accept a request that <em>someone else</em> sent to this user. */
export async function acceptFriendship(
  addresseeId: number,
  requesterId: number
): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `UPDATE friendships SET status = 'accepted'
     WHERE requester_id = $2 AND addressee_id = $1 AND status = 'pending'`,
    [addresseeId, requesterId]
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Declining a request and unfriending are the same operation: the row goes
 * away, in whichever direction it was stored. There is no "declined" state to
 * keep, because keeping one would only tell the sender they were turned down.
 */
export async function removeFriendship(a: number, b: number): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `DELETE FROM friendships
     WHERE (requester_id = $1 AND addressee_id = $2)
        OR (requester_id = $2 AND addressee_id = $1)`,
    [a, b]
  );
  return (rowCount ?? 0) > 0;
}

export interface PersonSummary {
  telegram_user_id: string;
  username: string | null;
  /** The name they chose in Navaar. Null until they have opened the app. */
  handle: string | null;
  has_avatar: boolean;
}

/**
 * Claim a handle, or report that somebody else already has it.
 *
 * The race is decided by the unique index rather than by a lookup followed by
 * a write: two people submitting the same handle in the same second both pass
 * a prior SELECT, and only the index can say which of them actually got it.
 * 23505 is Postgres unique_violation.
 */
export async function setHandle(
  telegramUserId: number,
  handle: string
): Promise<"ok" | "taken"> {
  try {
    await getPool().query(`UPDATE users SET handle = $2 WHERE telegram_user_id = $1`, [
      telegramUserId,
      handle,
    ]);
    return "ok";
  } catch (err) {
    if ((err as { code?: string }).code === "23505") return "taken";
    throw err;
  }
}

export async function listFriends(userId: number): Promise<PersonSummary[]> {
  const { rows } = await getPool().query<PersonSummary>(
    `SELECT u.telegram_user_id, u.username, u.handle, (u.avatar_file_id IS NOT NULL) AS has_avatar
     FROM friendships f
     JOIN users u ON u.telegram_user_id =
       CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END
     WHERE f.status = 'accepted' AND (f.requester_id = $1 OR f.addressee_id = $1)
     ORDER BY u.username NULLS LAST`,
    [userId]
  );
  return rows;
}

/**
 * Requests waiting on this user's answer. Only incoming ones: a pending request
 * the user sent is not shown back to them as something to act on, and the other
 * person is never told it is still sitting there.
 */
export async function listPendingFriendRequests(userId: number): Promise<PersonSummary[]> {
  const { rows } = await getPool().query<PersonSummary>(
    `SELECT u.telegram_user_id, u.username, u.handle, (u.avatar_file_id IS NOT NULL) AS has_avatar
     FROM friendships f
     JOIN users u ON u.telegram_user_id = f.requester_id
     WHERE f.addressee_id = $1 AND f.status = 'pending'
     ORDER BY u.username NULLS LAST`,
    [userId]
  );
  return rows;
}

/** Which requests this user has sent and not yet had answered. */
export async function listOutgoingFriendRequests(userId: number): Promise<string[]> {
  const { rows } = await getPool().query<{ addressee_id: string }>(
    `SELECT addressee_id FROM friendships
     WHERE requester_id = $1 AND status = 'pending'`,
    [userId]
  );
  return rows.map((row) => row.addressee_id);
}

/**
 * Username lookup, for the Social tab's search field. It is a fallback, not the
 * way friends are meant to be added: usernames are optional, changeable, and
 * typo-prone, which is exactly why the deep link exists.
 */
export async function findUserByUsername(username: string): Promise<PersonSummary | null> {
  const { rows } = await getPool().query<PersonSummary>(
    `SELECT telegram_user_id, username, handle, (avatar_file_id IS NOT NULL) AS has_avatar
     FROM users WHERE lower(username) = lower($1)`,
    [username.replace(/^@/, "")]
  );
  return rows[0] ?? null;
}

export async function getPerson(telegramUserId: number): Promise<PersonSummary | null> {
  const { rows } = await getPool().query<PersonSummary>(
    `SELECT telegram_user_id, username, handle, (avatar_file_id IS NOT NULL) AS has_avatar
     FROM users WHERE telegram_user_id = $1`,
    [telegramUserId]
  );
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Batch ingest sessions
// ---------------------------------------------------------------------------

export type IngestMode = "playlist" | "album";

export interface IngestSession {
  telegram_user_id: string;
  mode: IngestMode;
  playlist_id: string | null;
  album_name: string | null;
  status_chat_id: string | null;
  status_message_id: number | null;
  added_count: number;
  failed_names: string[];
  created_at: string;
  updated_at: string;
  status_edited_at: string | null;
  awaiting_name: boolean;
  name_prompt_message_id: number | null;
}

/** How long a session may sit untouched before the bot closes it out. */
export const INGEST_IDLE_MINUTES = 10;

/**
 * Open a session, replacing whatever the user had open. One per user: a second
 * /playlist while a batch is running means they changed their mind, not that
 * they want two destinations for the same forwarded file.
 */
export async function startIngestSession(
  telegramUserId: number,
  mode: IngestMode,
  playlistId: string | null
): Promise<IngestSession> {
  const { rows } = await getPool().query<IngestSession>(
    `INSERT INTO ingest_sessions (telegram_user_id, mode, playlist_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (telegram_user_id) DO UPDATE SET
       mode = EXCLUDED.mode,
       playlist_id = EXCLUDED.playlist_id,
       album_name = NULL,
       status_chat_id = NULL,
       status_message_id = NULL,
       added_count = 0,
       failed_names = '{}',
       created_at = now(),
       updated_at = now(),
       status_edited_at = NULL,
       awaiting_name = false,
       name_prompt_message_id = NULL
     RETURNING *`,
    [telegramUserId, mode, playlistId]
  );
  return rows[0];
}

export async function getIngestSession(
  telegramUserId: number
): Promise<IngestSession | null> {
  const { rows } = await getPool().query<IngestSession>(
    `SELECT * FROM ingest_sessions WHERE telegram_user_id = $1`,
    [telegramUserId]
  );
  return rows[0] ?? null;
}

export async function setIngestStatusMessage(
  telegramUserId: number,
  chatId: number,
  messageId: number
): Promise<void> {
  await getPool().query(
    `UPDATE ingest_sessions
     SET status_chat_id = $2, status_message_id = $3, status_edited_at = now()
     WHERE telegram_user_id = $1`,
    [telegramUserId, chatId, messageId]
  );
}

/** Records that the status message was just edited, for the edit debounce. */
export async function markIngestStatusEdited(telegramUserId: number): Promise<void> {
  await getPool().query(
    `UPDATE ingest_sessions SET status_edited_at = now() WHERE telegram_user_id = $1`,
    [telegramUserId]
  );
}

/**
 * Note a file that did not make it, and hand back the session so the caller can
 * redraw the status line. Returns null when the user has no batch open, which
 * is how the bot knows to answer the failure directly instead.
 */
export async function recordIngestFailure(
  telegramUserId: number,
  fileName: string
): Promise<IngestSession | null> {
  const { rows } = await getPool().query<IngestSession>(
    `UPDATE ingest_sessions
     SET failed_names = failed_names || $2::text, updated_at = now()
     WHERE telegram_user_id = $1
     RETURNING *`,
    [telegramUserId, fileName]
  );
  return rows[0] ?? null;
}

export async function setIngestAwaitingName(
  telegramUserId: number,
  promptMessageId: number
): Promise<void> {
  await getPool().query(
    `UPDATE ingest_sessions
     SET awaiting_name = true, name_prompt_message_id = $2, updated_at = now()
     WHERE telegram_user_id = $1`,
    [telegramUserId, promptMessageId]
  );
}

/**
 * Close a session and hand back what it accumulated, so the caller can write
 * the summary from the same row it just removed.
 */
export async function endIngestSession(
  telegramUserId: number
): Promise<IngestSession | null> {
  const { rows } = await getPool().query<IngestSession>(
    `DELETE FROM ingest_sessions WHERE telegram_user_id = $1 RETURNING *`,
    [telegramUserId]
  );
  return rows[0] ?? null;
}

/**
 * Sessions nobody has touched for a while. Swept lazily on the next thing the
 * bot does, because the free tier has no scheduler and a timer would not
 * survive the service being put to sleep anyway.
 */
export async function listIdleIngestSessions(): Promise<IngestSession[]> {
  const { rows } = await getPool().query<IngestSession>(
    `SELECT * FROM ingest_sessions
     WHERE updated_at < now() - make_interval(mins => $1)`,
    [INGEST_IDLE_MINUTES]
  );
  return rows;
}

/**
 * Insert a track and fold it into the caller's open batch in one transaction.
 *
 * The session is read here, under a row lock, rather than before the insert:
 * ending a batch and forwarding one last file are two Telegram updates that can
 * arrive together, and a track must not be filed into a playlist whose session
 * has already been closed and summarised.
 */
export async function createTrackInSession(
  input: NewTrack
): Promise<{ track: Track; session: IngestSession | null }> {
  return withTransaction(async (client) => {
    const { rows: sessionRows } = await client.query<IngestSession>(
      `SELECT * FROM ingest_sessions WHERE telegram_user_id = $1 FOR UPDATE`,
      [input.ownerTelegramId]
    );
    const session = sessionRows[0] ?? null;

    // In album mode the batch takes its name from the first file that carries
    // one, and every later file is retagged to match — that is what makes a
    // forwarded album one album rather than five spellings of it.
    let album = input.album;
    if (session?.mode === "album") {
      album = session.album_name ?? input.album;
      if (!session.album_name && album) {
        await client.query(
          `UPDATE ingest_sessions SET album_name = $2 WHERE telegram_user_id = $1`,
          [input.ownerTelegramId, album]
        );
        session.album_name = album;
      }
    }

    const { rows } = await client.query<Track>(
      INSERT_TRACK_SQL,
      insertTrackParams(input, album)
    );
    const track = rows[0];

    if (session) {
      if (session.mode === "playlist" && session.playlist_id) {
        await client.query(APPEND_PLAYLIST_TRACK_SQL, [
          session.playlist_id,
          track.id,
          input.ownerTelegramId,
        ]);
        await client.query(
          `UPDATE playlists SET updated_at = now() WHERE id = $1`,
          [session.playlist_id]
        );
      }

      const { rows: updated } = await client.query<IngestSession>(
        `UPDATE ingest_sessions
         SET added_count = added_count + 1, updated_at = now()
         WHERE telegram_user_id = $1
         RETURNING *`,
        [input.ownerTelegramId]
      );
      return { track, session: updated[0] ?? session };
    }

    return { track, session: null };
  });
}

/**
 * Applies the name the user finally gave the batch.
 *
 * A playlist is renamed. An album has no row to rename, so the tag is written
 * across the tracks the batch produced — identified by when they arrived, which
 * is sound because every file forwarded during a session belongs to it.
 */
export async function nameIngestBatch(
  session: IngestSession,
  name: string
): Promise<number> {
  const ownerId = Number(session.telegram_user_id);

  if (session.mode === "playlist") {
    if (!session.playlist_id) return 0;
    const { rowCount } = await getPool().query(
      `UPDATE playlists SET name = $3, updated_at = now()
       WHERE id = $1 AND owner_telegram_id = $2`,
      [session.playlist_id, ownerId, name]
    );
    return rowCount ?? 0;
  }

  const { rowCount } = await getPool().query(
    `UPDATE tracks SET album = $3
     WHERE owner_telegram_id = $1 AND created_at >= $2 AND ${LIVE}`,
    [ownerId, session.created_at, name]
  );
  return rowCount ?? 0;
}

/**
 * Removes a playlist a batch created but never filled. A /playlist that the
 * user abandoned should leave nothing behind in the library.
 */
export async function deletePlaylistIfEmpty(playlistId: string): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `DELETE FROM playlists p
     WHERE p.id = $1
       AND NOT EXISTS (SELECT 1 FROM playlist_tracks pt WHERE pt.playlist_id = p.id)`,
    [playlistId]
  );
  return (rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Batch discovery hint
// ---------------------------------------------------------------------------

/** Tracks this user has added in the last few minutes, for the /playlist hint. */
export async function countRecentTracks(
  ownerTelegramId: number,
  minutes: number
): Promise<number> {
  const { rows } = await getPool().query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM tracks
     WHERE owner_telegram_id = $1 AND ${LIVE}
       AND created_at > now() - make_interval(mins => $2)`,
    [ownerTelegramId, minutes]
  );
  return Number(rows[0]?.count ?? 0);
}

/**
 * Claims the once-a-day slot for the batch hint, returning whether this caller
 * got it. Done as a conditional UPDATE so two messages arriving together cannot
 * both decide to offer.
 */
export async function claimBatchHint(telegramUserId: number): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `UPDATE users SET batch_hint_at = now()
     WHERE telegram_user_id = $1
       AND (batch_hint_at IS NULL OR batch_hint_at < now() - make_interval(hours => 24))`,
    [telegramUserId]
  );
  return (rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Group chats
// ---------------------------------------------------------------------------

/**
 * The shared crate of a Telegram group.
 *
 * A group crate is an ordinary playlist with `group_chat_id` set, owned by
 * whoever added the bot, and visible to everyone the bot has seen in that chat
 * (see getTrackForListener). There is exactly one per chat — enforced by the
 * unique partial index, because two different updates can both decide to
 * create it.
 */
export async function getGroupPlaylist(
  groupChatId: number
): Promise<Playlist | null> {
  const { rows } = await getPool().query<Playlist>(
    `SELECT * FROM playlists WHERE group_chat_id = $1`,
    [groupChatId]
  );
  return rows[0] ?? null;
}

/**
 * Creates the group's crate, or hands back the one already there.
 *
 * `created` is what the caller uses to decide whether to post the privacy
 * disclosure, so it has to be the truth as the database saw it and not a
 * check-then-insert: being added to a chat and the first file posted in it can
 * arrive together, and the disclosure must be posted exactly once.
 */
export async function ensureGroupPlaylist(
  groupChatId: number,
  ownerTelegramId: number,
  name: string
): Promise<{ playlist: Playlist; created: boolean }> {
  const { rows } = await getPool().query<Playlist>(
    `INSERT INTO playlists (owner_telegram_id, name, visibility, group_chat_id)
     VALUES ($1, $2, 'friends', $3)
     ON CONFLICT (group_chat_id) WHERE group_chat_id IS NOT NULL DO NOTHING
     RETURNING *`,
    [ownerTelegramId, name, groupChatId]
  );
  if (rows[0]) return { playlist: rows[0], created: true };

  // DO NOTHING fired, which means the row is already there.
  const existing = await getGroupPlaylist(groupChatId);
  if (!existing) {
    throw new Error(`group playlist for chat ${groupChatId} could not be read back`);
  }
  return { playlist: existing, created: false };
}

/**
 * Records that this person has been seen in this chat.
 *
 * Bots cannot enumerate a group's membership, so this list is built from what
 * the bot happens to witness — joins, and any message from anyone. It answers
 * one question only, "has this person been seen in this chat", and that is what
 * the group crate's visibility check is built on. There is no backfill: nothing
 * sent before the bot joined is visible to it.
 */
export async function touchGroupMember(
  groupChatId: number,
  telegramUserId: number
): Promise<void> {
  await getPool().query(
    `INSERT INTO group_members (group_chat_id, telegram_user_id)
     VALUES ($1, $2)
     ON CONFLICT (group_chat_id, telegram_user_id)
     DO UPDATE SET last_seen_at = now()`,
    [groupChatId, telegramUserId]
  );
}

/** Someone left the chat, so the crate stops being visible to them. */
export async function removeGroupMember(
  groupChatId: number,
  telegramUserId: number
): Promise<void> {
  await getPool().query(
    `DELETE FROM group_members WHERE group_chat_id = $1 AND telegram_user_id = $2`,
    [groupChatId, telegramUserId]
  );
}

/**
 * Files a track posted in a group: the track belongs to the person who posted
 * it, the playlist entry records that it was them, and the crate itself belongs
 * to somebody else entirely. One transaction, so a track can never exist
 * without the crate entry that is the only reason it was created.
 *
 * The position comes back so the caller can tell the group when its crate has
 * just opened — the one message worth sending, as opposed to one per file.
 */
export async function createTrackInGroupCrate(
  input: NewTrack,
  playlistId: string
): Promise<{ track: Track; position: number | null }> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<Track>(
      INSERT_TRACK_SQL,
      insertTrackParams(input, input.album)
    );
    const track = rows[0];

    const { rows: placed } = await client.query<{ position: number }>(
      APPEND_PLAYLIST_TRACK_SQL,
      [playlistId, track.id, input.ownerTelegramId]
    );
    await client.query(`UPDATE playlists SET updated_at = now() WHERE id = $1`, [
      playlistId,
    ]);

    return { track, position: placed[0]?.position ?? null };
  });
}

// --- Channel registry --------------------------------------------------------

/**
 * Which Telegram channel plays which role for this deployment.
 *
 * Discovered rather than configured: a channel tells the bot its own id and
 * title in every update it sends, so the alternative — a human copying a
 * -100… number out of Telegram and into a dashboard — is work the bot can do
 * for itself and never mistype. Persisted because discovery happens once and
 * the process it happened in will not be the one still running tomorrow.
 */
export type ChannelRole = "covers" | "logs";

export async function getAppChannel(role: ChannelRole): Promise<number | null> {
  const { rows } = await getPool().query<{ chat_id: string }>(
    `SELECT chat_id FROM app_channels WHERE role = $1`,
    [role]
  );
  // BIGINT arrives as a string from pg; channel ids are far inside the safe
  // integer range, so the narrowing is lossless.
  return rows[0] ? Number(rows[0].chat_id) : null;
}

export async function setAppChannel(
  role: ChannelRole,
  chatId: number,
  title: string | null
): Promise<void> {
  await getPool().query(
    `INSERT INTO app_channels (role, chat_id, title) VALUES ($1, $2, $3)
     ON CONFLICT (role) DO UPDATE
       SET chat_id = EXCLUDED.chat_id,
           title = EXCLUDED.title,
           updated_at = now()`,
    [role, chatId, title]
  );
}

// ---------------------------------------------------------------------------
// Listening, history and activity
// ---------------------------------------------------------------------------

/**
 * How long a listening status counts as "now".
 *
 * Nothing can be relied on to clear one. A Mini App is closed by swiping it
 * away and a WebView that is killed never runs its teardown, so a status that
 * had to be switched off would sit there forever claiming somebody is still
 * playing a song they finished on the bus this morning. The window clears it
 * instead: the player re-posts while it is playing and stops the moment it is
 * not, so the row goes stale on its own and the feed stops returning it. Ten
 * minutes is longer than nearly every track and short enough that "listening
 * now" is not a lie.
 */
const LISTENING_WINDOW_MINUTES = 10;

/**
 * How long a play stays in the history.
 *
 * `plays` is the only table here that grows without bound, and there is no
 * cron on a free instance that sleeps — so the prune rides along with the
 * insert. Ninety days is well past anything the app shows and keeps the table
 * a fixed size rather than a slowly filling one.
 */
const PLAY_RETENTION_DAYS = 90;

/** How far back the activity feed looks, and how many rows it will carry. */
const ACTIVITY_WINDOW_DAYS = 30;
const ACTIVITY_LIMIT = 30;

const RECENTLY_PLAYED_LIMIT = 50;

/**
 * The person columns, prefixed, so one row can carry two different people.
 *
 * A save names two: whoever saved the track and whoever they got it from. They
 * come back from the same row and have to be told apart, which is what the
 * prefix is for — and pairing the SELECT list with the reader below is what
 * stops the two from drifting apart.
 */
function personColumns(alias: string, prefix: string): string {
  return `${alias}.telegram_user_id AS ${prefix}_id,
          ${alias}.username AS ${prefix}_username,
          ${alias}.handle AS ${prefix}_handle,
          (${alias}.avatar_file_id IS NOT NULL) AS ${prefix}_has_avatar`;
}

/** Reads back what personColumns wrote. Null when the join found nobody. */
function personFrom(
  row: Record<string, unknown>,
  prefix: string
): PersonSummary | null {
  const id = row[`${prefix}_id`];
  if (id == null) return null;
  return {
    telegram_user_id: String(id),
    username: (row[`${prefix}_username`] as string | null) ?? null,
    handle: (row[`${prefix}_handle`] as string | null) ?? null,
    has_avatar: Boolean(row[`${prefix}_has_avatar`]),
  };
}

/**
 * A track as a social row carries it: enough to name, not enough to play.
 *
 * `cover_track_id` is the id to fetch artwork from and is null unless the
 * viewer may actually fetch it — a friend can be listening to a track that is
 * in none of the playlists they share, and the cover route would rightly 404
 * on it. A null here draws the generated tile instead of a broken image.
 */
export interface ActivityTrack {
  id: string;
  title: string | null;
  artist: string | null;
  cover_track_id: string | null;
}

/** Somebody's listening status, as one of their friends sees it. */
export interface ListeningNow {
  person: PersonSummary;
  track: ActivityTrack;
  /** When they were last heard from; always inside the listening window. */
  at: string;
}

/** A playlist as a social row carries it. Deliberately without share_slug. */
export interface ActivityPlaylist {
  id: string;
  name: string;
  has_cover: boolean;
  cover_track_id: string | null;
  updated_at: string;
}

export type ActivityKind = "listening" | "shared" | "saved";

/**
 * One row of the Social feed.
 *
 * `person` is who did the thing, and is always someone the viewer can see —
 * that is the whole filter on every branch of the feed. `from` is the second
 * name a save carries, and is null unless the viewer can see that person too:
 * "@sara saved — from @ali" hands Ali's name to everyone Sara is friends with,
 * which is a stranger's name to most of them. The row stops at "@sara saved"
 * rather than naming him, and the SQL is what decides that, not the client.
 */
export interface ActivityItem {
  kind: ActivityKind;
  at: string;
  person: PersonSummary;
  from: PersonSummary | null;
  track: ActivityTrack | null;
  playlist: ActivityPlaylist | null;
}

/**
 * Say what this person is playing, or clear it.
 *
 * The track is checked against the same visibility expression the read paths
 * use, so a status can only ever name a track its owner may actually have —
 * a client that posted somebody else's id would broadcast a title out of a
 * library it cannot open. Returns false when there is no such track for them,
 * which the route answers with a 404 like every other invisible resource.
 *
 * is_public is untouched here. It is set on its own route and must survive a
 * status write, or every track change would quietly re-open the curtains.
 */
export async function setListeningStatus(
  telegramUserId: number,
  trackId: string | null
): Promise<boolean> {
  const pool = getPool();

  if (trackId === null) {
    await pool.query(
      `INSERT INTO listen_status (telegram_user_id, track_id, updated_at)
       VALUES ($1, NULL, now())
       ON CONFLICT (telegram_user_id)
       DO UPDATE SET track_id = NULL, updated_at = now()`,
      [telegramUserId]
    );
    return true;
  }

  const { rowCount } = await pool.query(
    `INSERT INTO listen_status (telegram_user_id, track_id, updated_at)
     SELECT $1, t.id, now()
     FROM tracks t
     WHERE t.id = $2 AND ${LIVE_T} AND ${trackVisibleTo("$1", "t")}
     ON CONFLICT (telegram_user_id)
     DO UPDATE SET track_id = EXCLUDED.track_id, updated_at = now()`,
    [telegramUserId, trackId]
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Whether this person's listening is shown to their friends at all.
 *
 * Switching it off clears the track as well as the flag. Leaving the last one
 * behind would mean that turning it back on an hour later re-broadcasts
 * whatever was playing when it went off, which is not what the switch appears
 * to promise; the player posts the current track again as soon as it is on.
 */
export async function setListeningPrivacy(
  telegramUserId: number,
  isPublic: boolean
): Promise<void> {
  await getPool().query(
    `INSERT INTO listen_status (telegram_user_id, is_public, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (telegram_user_id)
     DO UPDATE SET is_public = EXCLUDED.is_public,
       track_id = CASE WHEN EXCLUDED.is_public THEN listen_status.track_id END`,
    [telegramUserId, isPublic]
  );
}

/**
 * What this viewer's friends are playing right now.
 *
 * Three conditions and no fourth: an accepted friendship, a status they chose
 * to make public, and a timestamp inside the window. Anyone outside that
 * returns nothing at all — there is no row saying somebody is hidden, because
 * a placeholder for a person who opted out tells you exactly the thing they
 * opted out of telling you.
 */
export async function listFriendsListening(
  viewerTelegramId: number
): Promise<ListeningNow[]> {
  const { rows } = await getPool().query<Record<string, unknown>>(
    `SELECT ${personColumns("u", "person")},
       t.id AS track_id, t.title, t.artist,
       CASE WHEN ${HAS_COVER_T} AND ${trackVisibleTo("$1", "t")} THEN t.id END
         AS cover_track_id,
       ls.updated_at AS at
     FROM listen_status ls
     JOIN users u ON u.telegram_user_id = ls.telegram_user_id
     JOIN tracks t ON t.id = ls.track_id
     WHERE ls.is_public
       AND ls.updated_at > now() - interval '${LISTENING_WINDOW_MINUTES} minutes'
       AND ${LIVE_T}
       AND EXISTS (
         SELECT 1 FROM friendships f
         WHERE f.status = 'accepted'
           AND ((f.requester_id = $1 AND f.addressee_id = ls.telegram_user_id)
             OR (f.requester_id = ls.telegram_user_id AND f.addressee_id = $1))
       )
     ORDER BY ls.updated_at DESC`,
    [viewerTelegramId]
  );

  return rows.map((row) => ({
    person: personFrom(row, "person")!,
    track: {
      id: String(row.track_id),
      title: (row.title as string | null) ?? null,
      artist: (row.artist as string | null) ?? null,
      cover_track_id: (row.cover_track_id as string | null) ?? null,
    },
    at: new Date(row.at as string | Date).toISOString(),
  }));
}

/**
 * Record a play, and take out the old ones on the way past.
 *
 * The prune is part of the insert rather than a job of its own because there
 * is nowhere to run a job: the instance sleeps after fifteen idle minutes, so
 * anything on a timer is anything that never runs. Doing it here means the
 * table is trimmed exactly as often as it grows, and most calls delete nothing
 * at all — an index probe that finds no row older than the cutoff.
 *
 * The track is visibility-checked for the same reason the status is: a play is
 * the input to your own history, and a history should not be able to hold a
 * row out of a library you cannot open.
 */
export async function recordPlay(
  telegramUserId: number,
  trackId: string
): Promise<boolean> {
  const { rowCount } = await getPool().query(
    `WITH pruned AS (
       DELETE FROM plays
       WHERE played_at < now() - interval '${PLAY_RETENTION_DAYS} days'
     )
     INSERT INTO plays (telegram_user_id, track_id)
     SELECT $1, t.id
     FROM tracks t
     WHERE t.id = $2 AND ${LIVE_T} AND ${trackVisibleTo("$1", "t")}`,
    [telegramUserId, trackId]
  );
  return (rowCount ?? 0) > 0;
}

/**
 * The last fifty distinct tracks this person played, most recent first.
 *
 * Distinct, because a history that lists the song you had on repeat fifty
 * times is a history with one song in it. A track that has since been deleted
 * — or that sat in a playlist whose owner has stopped sharing it — drops out
 * rather than appearing as a row that cannot be played.
 */
export async function listRecentlyPlayed(
  telegramUserId: number
): Promise<Track[]> {
  const { rows } = await getPool().query<Track>(
    `SELECT ${TRACK_COLUMNS_T}
     FROM (
       SELECT track_id, MAX(played_at) AS last_at
       FROM plays
       WHERE telegram_user_id = $1
       GROUP BY track_id
     ) recent
     JOIN tracks t ON t.id = recent.track_id
     WHERE ${LIVE_T} AND ${trackVisibleTo("$1", "t")}
     ORDER BY recent.last_at DESC
     LIMIT ${RECENTLY_PLAYED_LIMIT}`,
    [telegramUserId]
  );
  return rows;
}

/**
 * Playlists the people this viewer knows have opened up lately.
 *
 * Ordered by when the playlist last changed, which is the nearest thing
 * recorded to when it was shared — a visibility change bumps `updated_at`, and
 * so does a rename. That imprecision is deliberate rather than a column: what
 * the row is for is "there is something of theirs worth opening", and a
 * playlist they renamed and added four tracks to yesterday is exactly that.
 *
 * Two predicates, because they answer two questions. `playlistVisibleTo` is the
 * same one the playlist reads use, so the feed can never advertise something
 * that would 404 when tapped — but it passes any link-shared playlist, and
 * "anyone holding the link may open this" is not "everybody should be told
 * about it, by name". `canSeePerson` is what keeps a stranger out of the feed.
 */
async function listRecentShares(
  viewerTelegramId: number
): Promise<ActivityItem[]> {
  const { rows } = await getPool().query<Record<string, unknown>>(
    `SELECT ${personColumns("u", "person")},
       p.id, p.name, p.updated_at,
       (p.cover_file_id IS NOT NULL) AS has_cover,
       ${PLAYLIST_COVER}
     FROM playlists p
     JOIN users u ON u.telegram_user_id = p.owner_telegram_id
     WHERE p.owner_telegram_id <> $1
       AND p.visibility <> 'private'
       AND p.group_chat_id IS NULL
       AND p.updated_at > now() - interval '${ACTIVITY_WINDOW_DAYS} days'
       AND ${playlistVisibleTo("$1")}
       AND ${canSeePerson("$1", "p.owner_telegram_id")}
     ORDER BY p.updated_at DESC
     LIMIT ${ACTIVITY_LIMIT}`,
    [viewerTelegramId]
  );

  return rows.map((row) => ({
    kind: "shared" as const,
    at: new Date(row.updated_at as string | Date).toISOString(),
    person: personFrom(row, "person")!,
    from: null,
    track: null,
    playlist: {
      id: String(row.id),
      name: String(row.name),
      has_cover: Boolean(row.has_cover),
      cover_track_id: (row.cover_track_id as string | null) ?? null,
      updated_at: new Date(row.updated_at as string | Date).toISOString(),
    },
  }));
}

/**
 * Tracks the people this viewer knows have kept from somebody.
 *
 * The second name is the point of the row and also its one hazard, so the
 * join that fetches it carries the visibility test in its own ON clause: when
 * the viewer cannot see the person the track came from, the LEFT JOIN finds
 * nothing and `from` is null. There is no branch in the application code that
 * could be forgotten, and no query that returns the name for the client to
 * decide about.
 */
async function listRecentSaves(
  viewerTelegramId: number
): Promise<ActivityItem[]> {
  const { rows } = await getPool().query<Record<string, unknown>>(
    `SELECT ${personColumns("s", "person")},
       ${personColumns("o", "from")},
       ts.created_at,
       t.id AS track_id, t.title, t.artist,
       CASE WHEN ${HAS_COVER_T} AND ${trackVisibleTo("$1", "t")} THEN t.id END
         AS cover_track_id
     FROM track_saves ts
     JOIN users s ON s.telegram_user_id = ts.saver_id
     JOIN tracks t ON t.id = ts.saved_track_id
     LEFT JOIN users o
       ON o.telegram_user_id = ts.origin_id
       AND ${canSeePerson("$1", "ts.origin_id")}
     WHERE ts.saver_id <> $1
       AND ts.created_at > now() - interval '${ACTIVITY_WINDOW_DAYS} days'
       AND ${LIVE_T}
       AND ${canSeePerson("$1", "ts.saver_id")}
     ORDER BY ts.created_at DESC
     LIMIT ${ACTIVITY_LIMIT}`,
    [viewerTelegramId]
  );

  return rows.map((row) => ({
    kind: "saved" as const,
    at: new Date(row.created_at as string | Date).toISOString(),
    person: personFrom(row, "person")!,
    from: personFrom(row, "from"),
    track: {
      id: String(row.track_id),
      title: (row.title as string | null) ?? null,
      artist: (row.artist as string | null) ?? null,
      cover_track_id: (row.cover_track_id as string | null) ?? null,
    },
    playlist: null,
  }));
}

/**
 * The Social feed: who is listening, what has been shared, what has been kept.
 *
 * Three queries rather than one union, because the three have almost nothing
 * in common but their ordering — a union would have to pad each branch with
 * the other two's columns and the result would be harder to read than the
 * thing it saved. They go out together on one pool and are merged here.
 *
 * Every branch is already capped, so the merge is at most ninety rows in
 * memory before the cap that matters. Listening rows are always inside the
 * ten-minute window and therefore always sort to the top, which is the order
 * the screen wants anyway.
 */
export async function listSocialActivity(
  viewerTelegramId: number
): Promise<ActivityItem[]> {
  const [listening, shared, saved] = await Promise.all([
    listFriendsListening(viewerTelegramId),
    listRecentShares(viewerTelegramId),
    listRecentSaves(viewerTelegramId),
  ]);

  const nowPlaying: ActivityItem[] = listening.map((row) => ({
    kind: "listening" as const,
    at: row.at,
    person: row.person,
    from: null,
    track: row.track,
    playlist: null,
  }));

  return [...nowPlaying, ...shared, ...saved]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, ACTIVITY_LIMIT);
}

// ---------------------------------------------------------------------------
// Discovery, profiles and endorsements
// ---------------------------------------------------------------------------

/** How many people a search will name, and how many suggestions are offered. */
const SEARCH_LIMIT = 20;
const SUGGESTION_LIMIT = 20;

/**
 * The shortest thing that counts as looking for somebody.
 *
 * One character is not a search, it is the first page of the membership list.
 * Two is still short, but it is short in the way a name somebody told you is
 * short, and the result set is capped either way.
 */
const SEARCH_MIN_LENGTH = 2;

/**
 * Where the viewer stands with somebody, as a single column.
 *
 * Search results need this per row or every row would render an Add button
 * that is wrong for half of them — already friends, or already asked, or
 * waiting on an answer the viewer owes. Computing it in the query is what
 * makes the screen one request instead of one plus a friends list plus a
 * pending list.
 *
 * Spliced into larger queries, so both arguments must be placeholders or
 * column references and never anything out of a request.
 *
 * The ordering inside the subquery is defensive. Only one row per pair is ever
 * written — requestFriendship takes a lock and checks both directions — but a
 * scalar subquery that found two would raise rather than return, and a search
 * screen is not where that should be discovered.
 */
function friendshipState(viewer: string, other: string): string {
  return `(CASE WHEN ${other} = ${viewer} THEN 'self' ELSE COALESCE((
    SELECT CASE
             WHEN f.status = 'accepted' THEN 'friends'
             WHEN f.requester_id = ${viewer} THEN 'pending_out'
             ELSE 'pending_in'
           END
    FROM friendships f
    WHERE (f.requester_id = ${viewer} AND f.addressee_id = ${other})
       OR (f.requester_id = ${other} AND f.addressee_id = ${viewer})
    ORDER BY (f.status = 'accepted') DESC
    LIMIT 1
  ), 'none') END)`;
}

export type FriendshipState =
  | "self"
  | "friends"
  | "pending_out"
  | "pending_in"
  | "none";

/** A person as a search result carries them: who they are, and where you stand. */
export interface PersonResult extends PersonSummary {
  state: FriendshipState;
}

/** Somebody the viewer has not met, and how many friends they have in common. */
export interface Suggestion extends PersonSummary {
  mutual_count: number;
}

/**
 * Look for somebody by the name they chose, or by their Telegram username.
 *
 * Prefix matching over the local users table and nothing else: there is no
 * remote lookup to make, and matching in the middle of a name would turn a
 * two-letter query into a directory dump. The handle is tried first and
 * ordered first, because it is the name that belongs to this app and the one
 * people are told to hand out.
 *
 * The query is escaped rather than interpolated, so a search for "50%" is a
 * search for two characters and not for everybody.
 */
export async function searchPeople(
  viewerTelegramId: number,
  query: string
): Promise<PersonResult[]> {
  const trimmed = query.trim().replace(/^@+/, "");
  if (trimmed.length < SEARCH_MIN_LENGTH) return [];
  const prefix = trimmed.replace(/[\\%_]/g, "\\$&") + "%";

  const { rows } = await getPool().query<PersonResult>(
    `SELECT u.telegram_user_id, u.username, u.handle,
       (u.avatar_file_id IS NOT NULL) AS has_avatar,
       ${friendshipState("$1", "u.telegram_user_id")} AS state
     FROM users u
     WHERE u.telegram_user_id <> $1
       AND (u.handle ILIKE $2 OR u.username ILIKE $2)
     ORDER BY (u.handle ILIKE $2) DESC, LOWER(COALESCE(u.handle, u.username))
     LIMIT ${SEARCH_LIMIT}`,
    [viewerTelegramId, prefix]
  );
  return rows;
}

/**
 * People the viewer's friends are friends with.
 *
 * Two hops, and the second hop is the last one — a third would reach people
 * with no relationship to the viewer at all, which is a recommendation engine
 * rather than an introduction. Anyone already connected is excluded, and that
 * includes pending requests in both directions: this list exists so that the
 * answer to every row is "add them", and somebody already asked, or waiting on
 * the viewer's own answer, does not belong in it.
 *
 * The mutual count is what makes the ordering mean anything, and it is the one
 * number here that is safe to show: it counts the viewer's own friends, so
 * every person it is derived from is somebody the viewer already knows.
 */
export async function listFriendSuggestions(
  viewerTelegramId: number
): Promise<Suggestion[]> {
  const { rows } = await getPool().query<Suggestion>(
    `WITH mine AS (
       SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END AS id
       FROM friendships
       WHERE status = 'accepted' AND $1 IN (requester_id, addressee_id)
     ),
     connected AS (
       SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END AS id
       FROM friendships
       WHERE $1 IN (requester_id, addressee_id)
     )
     SELECT u.telegram_user_id, u.username, u.handle,
       (u.avatar_file_id IS NOT NULL) AS has_avatar,
       COUNT(*)::int AS mutual_count
     FROM mine m
     JOIN friendships f
       ON f.status = 'accepted' AND m.id IN (f.requester_id, f.addressee_id)
     JOIN users u ON u.telegram_user_id =
       CASE WHEN f.requester_id = m.id THEN f.addressee_id ELSE f.requester_id END
     WHERE u.telegram_user_id <> $1
       AND u.telegram_user_id NOT IN (SELECT id FROM connected)
     GROUP BY u.telegram_user_id, u.username, u.handle, u.avatar_file_id
     ORDER BY mutual_count DESC, LOWER(COALESCE(u.handle, u.username))
     LIMIT ${SUGGESTION_LIMIT}`,
    [viewerTelegramId]
  );
  return rows;
}

/**
 * One person's page.
 *
 * Everything on it is already scoped by whatever produced it: the playlists
 * come from the listener-scoped read, so somebody unconnected gets the ones
 * published to anyone and a friend gets more, and neither case needs a branch
 * here.
 *
 * The endorsement count is turned into a tier inside this function and never
 * returned. Somewhere the raw number has to be counted, and this is the only
 * place it exists — a route that wanted to render "12 endorsements" would have
 * to come here and change this line, which is the point of putting it here.
 */
export interface UserProfile {
  person: PersonSummary;
  state: FriendshipState;
  tier: BadgeTier;
  /** Whether the viewer has already endorsed them. */
  endorsed: boolean;
  /**
   * Whether the viewer is allowed to. True only once they have kept a track
   * that came from this person — the same rule the insert enforces, asked
   * ahead of time so the button is absent rather than refused.
   */
  can_endorse: boolean;
  playlists: Playlist[];
}

export async function getUserProfile(
  viewerTelegramId: number,
  targetTelegramId: number
): Promise<UserProfile | null> {
  const { rows } = await getPool().query<Record<string, unknown>>(
    `SELECT u.telegram_user_id, u.username, u.handle,
       (u.avatar_file_id IS NOT NULL) AS has_avatar,
       ${friendshipState("$1", "u.telegram_user_id")} AS state,
       (SELECT COUNT(*)::int FROM endorsements e
         WHERE e.endorsee_id = u.telegram_user_id) AS endorsement_count,
       EXISTS (SELECT 1 FROM endorsements e
         WHERE e.endorsee_id = u.telegram_user_id AND e.endorser_id = $1) AS endorsed,
       EXISTS (SELECT 1 FROM track_saves ts
         WHERE ts.saver_id = $1 AND ts.origin_id = u.telegram_user_id) AS has_saved
     FROM users u
     WHERE u.telegram_user_id = $2`,
    [viewerTelegramId, targetTelegramId]
  );

  const row = rows[0];
  if (!row) return null;

  const endorsed = Boolean(row.endorsed);
  return {
    person: {
      telegram_user_id: String(row.telegram_user_id),
      username: (row.username as string | null) ?? null,
      handle: (row.handle as string | null) ?? null,
      has_avatar: Boolean(row.has_avatar),
    },
    state: row.state as FriendshipState,
    tier: tierFor(Number(row.endorsement_count ?? 0)),
    endorsed,
    can_endorse: !endorsed && Boolean(row.has_saved),
    playlists: await listPlaylistsVisibleTo(targetTelegramId, viewerTelegramId),
  };
}

/**
 * Endorse somebody, if it has been earned.
 *
 * The rule is that you may only endorse a person whose music you have actually
 * kept, and it is the INSERT that enforces it: the row only comes into being
 * if the SELECT feeding it finds a save. There is no read-then-write for a
 * second request to slip between, and no route that can decide to skip the
 * check because the caller looked like somebody who would pass it.
 *
 * Three outcomes rather than a boolean, because the route answers them
 * differently: an endorsement that is already there is not a failure and must
 * not read as one, while an endorsement that was never earned is a refusal.
 */
export async function endorsePerson(
  endorserId: number,
  endorseeId: number
): Promise<"ok" | "already" | "not-earned"> {
  if (endorserId === endorseeId) return "not-earned";

  const { rowCount } = await getPool().query(
    `INSERT INTO endorsements (endorser_id, endorsee_id)
     SELECT $1, $2
     WHERE EXISTS (
       SELECT 1 FROM track_saves ts
       WHERE ts.saver_id = $1 AND ts.origin_id = $2
     )
     ON CONFLICT DO NOTHING`,
    [endorserId, endorseeId]
  );
  if ((rowCount ?? 0) > 0) return "ok";

  // Nothing was inserted, which is either of two very different things.
  const { rows } = await getPool().query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM endorsements
       WHERE endorser_id = $1 AND endorsee_id = $2
     ) AS exists`,
    [endorserId, endorseeId]
  );
  return rows[0]?.exists ? "already" : "not-earned";
}
