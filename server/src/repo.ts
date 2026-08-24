import { getPool, withTransaction } from "./db";
import type { Track, Playlist } from "./types";

export async function ensureUser(
  telegramUserId: number,
  username: string | undefined
): Promise<void> {
  await getPool().query(
    `INSERT INTO users (telegram_user_id, username)
     VALUES ($1, $2)
     ON CONFLICT (telegram_user_id)
     DO UPDATE SET username = EXCLUDED.username`,
    [telegramUserId, username ?? null]
  );
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
   * Who first brought this track into Navaar. Defaults to the owner on a fresh
   * ingest; the save path passes the source's value through instead, so a copy
   * of a copy still credits the person at the head of the chain.
   */
  originAdderId: number | null;
}

// Excludes cover_image so list/get/update calls never pull cover bytes over
// the wire; the dedicated cover route/query below fetches those on demand.
const TRACK_COLUMNS = `
  id, owner_telegram_id, title, artist, album, duration_seconds,
  telegram_file_id, mime_type, (cover_image IS NOT NULL) AS has_cover,
  origin_adder_id, favorited_at, (lyrics IS NOT NULL) AS has_lyrics, created_at
`;

// The same list, qualified, for the queries that join tracks to something else.
const TRACK_COLUMNS_T = `
  t.id, t.owner_telegram_id, t.title, t.artist, t.album, t.duration_seconds,
  t.telegram_file_id, t.mime_type, (t.cover_image IS NOT NULL) AS has_cover,
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
     mime_type, cover_image, cover_mime_type, origin_adder_id)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11::BIGINT, $2))
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
       CASE WHEN ${visible} THEN ou.username END AS credit_username,
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
 * The listener-scoped lookup, for read paths only. Deliberately a different
 * name from getTrack rather than a flag on it: a boolean argument is easy to
 * pass the wrong way round on a mutation route, a second function name is not.
 *
 * A requester may read a track when any one of four things is true — they own
 * it, it is in a friend's shared playlist, it is in a link-shared playlist, or
 * it is in a group playlist for a chat they are in. All four are expressed as
 * one query so that a partially-evaluated chain of application-code checks can
 * never leak a track the last check would have refused.
 */
export async function getTrackForListener(
  id: string,
  requesterTelegramId: number
): Promise<Track | null> {
  const { rows } = await getPool().query<Track>(
    `SELECT ${TRACK_COLUMNS_T}
     FROM tracks t
     WHERE t.id = $1
       AND ${LIVE_T}
       AND (
         t.owner_telegram_id = $2
         OR EXISTS (
           SELECT 1
           FROM playlist_tracks pt
           JOIN playlists p ON p.id = pt.playlist_id
           WHERE pt.track_id = t.id
             AND (
               -- Anyone holding the link.
               p.visibility = 'public'

               -- A playlist an accepted friend opened up.
               OR (
                 p.visibility IN ('friends', 'public')
                 AND EXISTS (
                   SELECT 1 FROM friendships f
                   WHERE f.status = 'accepted'
                     AND ((f.requester_id = $2 AND f.addressee_id = p.owner_telegram_id)
                       OR (f.requester_id = p.owner_telegram_id AND f.addressee_id = $2))
                 )
               )

               -- A group playlist for a chat the requester has been seen in.
               OR (
                 p.group_chat_id IS NOT NULL
                 AND EXISTS (
                   SELECT 1 FROM group_members gm
                   WHERE gm.group_chat_id = p.group_chat_id
                     AND gm.telegram_user_id = $2
                 )
               )
             )
         )
       )`,
    [id, requesterTelegramId]
  );
  return rows[0] ?? null;
}

/** Tracks whose artwork was never captured — the input to a cover backfill. */
export async function listTracksMissingCover(
  ownerTelegramId: number
): Promise<Pick<Track, "id" | "title" | "telegram_file_id">[]> {
  const { rows } = await getPool().query<
    Pick<Track, "id" | "title" | "telegram_file_id">
  >(
    `SELECT id, title, telegram_file_id FROM tracks
     WHERE owner_telegram_id = $1 AND cover_image IS NULL AND ${LIVE}
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

export interface TrackCover {
  coverImage: Buffer;
  coverMimeType: string | null;
}

/**
 * Unscoped on purpose: the caller has already established that it may see this
 * track, via getTrack for its own or getTrackForListener for somebody else's.
 */
export async function getTrackCover(id: string): Promise<TrackCover | null> {
  const { rows } = await getPool().query<{
    cover_image: Buffer | null;
    cover_mime_type: string | null;
  }>(
    `SELECT cover_image, cover_mime_type FROM tracks WHERE id = $1 AND ${LIVE}`,
    [id]
  );
  const row = rows[0];
  if (!row?.cover_image) return null;
  return { coverImage: row.cover_image, coverMimeType: row.cover_mime_type };
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

export async function updateTrackCover(
  id: string,
  ownerTelegramId: number,
  coverImage: Buffer,
  coverMimeType: string
): Promise<Track | null> {
  const { rows } = await getPool().query<Track>(
    `UPDATE tracks SET cover_image = $3, cover_mime_type = $4
     WHERE id = $1 AND owner_telegram_id = $2 AND ${LIVE}
     RETURNING ${TRACK_COLUMNS}`,
    [id, ownerTelegramId, coverImage, coverMimeType]
  );
  return rows[0] ?? null;
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
     p.created_at, p.updated_at, p.visibility, p.share_slug, p.group_chat_id`;

/**
 * The picture: whatever the owner pinned, and otherwise the first track in the
 * playlist that carries artwork.
 *
 * Resolving on read rather than storing means a playlist nobody has ever given
 * a cover to still has one, and a playlist whose pinned track was later deleted
 * quietly goes back to choosing for itself instead of showing a blank square.
 */
const PLAYLIST_COVER = `COALESCE(
       (SELECT t.id FROM tracks t
        WHERE t.id = p.cover_track_id AND ${LIVE_T} AND t.cover_image IS NOT NULL),
       (SELECT t.id FROM playlist_tracks pt
        JOIN tracks t ON t.id = pt.track_id
        WHERE pt.playlist_id = p.id AND ${LIVE_T} AND t.cover_image IS NOT NULL
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
async function readPlaylist(
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
  fields: { name?: string; description?: string | null }
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
  // Nothing to write is not an error — the caller still wants the row back.
  if (sets.length === 0) return readPlaylist(id, ownerTelegramId);

  const { rowCount } = await getPool().query(
    `UPDATE playlists SET ${sets.join(", ")}, updated_at = now()
     WHERE id = $1 AND owner_telegram_id = $2`,
    params
  );
  if ((rowCount ?? 0) === 0) return null;
  return readPlaylist(id, ownerTelegramId);
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
  return readPlaylist(id, ownerTelegramId);
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
         FILTER (WHERE t.cover_image IS NOT NULL))[1] AS cover_track_id,
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
  has_avatar: boolean;
}

export async function listFriends(userId: number): Promise<PersonSummary[]> {
  const { rows } = await getPool().query<PersonSummary>(
    `SELECT u.telegram_user_id, u.username, (u.avatar_file_id IS NOT NULL) AS has_avatar
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
    `SELECT u.telegram_user_id, u.username, (u.avatar_file_id IS NOT NULL) AS has_avatar
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
    `SELECT telegram_user_id, username, (avatar_file_id IS NOT NULL) AS has_avatar
     FROM users WHERE lower(username) = lower($1)`,
    [username.replace(/^@/, "")]
  );
  return rows[0] ?? null;
}

export async function getPerson(telegramUserId: number): Promise<PersonSummary | null> {
  const { rows } = await getPool().query<PersonSummary>(
    `SELECT telegram_user_id, username, (avatar_file_id IS NOT NULL) AS has_avatar
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
