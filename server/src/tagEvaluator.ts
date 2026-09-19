/**
 * Evaluates and unlocks Navaar Tags.
 *
 * Deliberately self-contained: this module imports only from ./db and
 * ./tags, never from ./repo. repo.ts calls into this module from inside its
 * own mutation functions (recordPlay, saveTrackToLibrary, acceptFriendship,
 * and so on — several of which are reached from bot code, not just Express
 * routes, so the hook has to live at the repo layer to see every path a
 * track/playlist/friendship can be created through). Importing repo.ts back
 * from here would close that into a cycle, so the small amount of overlap
 * (splitting a multi-artist tag, the has-cover predicate) is reimplemented
 * locally rather than shared.
 *
 * Every exported function is a thin, best-effort side call: it never throws
 * past its own boundary, so a tag-evaluation failure can never break the
 * primary action (a play, a save, a friend acceptance) it rides along with.
 */
import { getPool } from "./db";
import { TAG_BY_ID } from "./tags";

/** Mirrors repo.ts's own splitArtists — see the note above for why it isn't imported. */
const ARTIST_SPLIT = /\s*,\s*|\s+feat\.?\s+|\s+ft\.?\s+|\s+with\s+/gi;
function splitArtists(raw: string): string[] {
  return raw
    .split(ARTIST_SPLIT)
    .map((name) => name.trim())
    .filter(Boolean);
}

/** Collapses "Thom Yorke", " thom  yorke ", "THOM YORKE" to the same key. */
function normalizeArtist(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Local minutes-since-midnight covering 00:00 up to (not including) 05:00. */
const MIDNIGHT_WINDOW_END_MINUTE = 300;
/** 04:43:30–04:44:59, collapsed to the two minute values it can round to. */
const FOUR_FOUR_FOUR_MINUTES = new Set([283, 284]);

async function unlockTags(telegramUserId: number, tagIds: string[]): Promise<void> {
  const known = tagIds.filter((id) => TAG_BY_ID.has(id));
  if (known.length === 0) return;
  await getPool().query(
    `INSERT INTO user_tags (telegram_user_id, tag_id)
     SELECT $1, x FROM unnest($2::text[]) AS x
     ON CONFLICT DO NOTHING`,
    [telegramUserId, known]
  );
}

/**
 * The eight listening/aggregate tags (including the two secret ones whose
 * condition is a pure counter threshold: Obsessive and, via evaluateLibraryTags,
 * Archivist) — recomputed from durable state after every qualified play.
 */
async function evaluateListeningTags(telegramUserId: number): Promise<void> {
  const pool = getPool();
  const [trackStats, midnightRow, dayRow, artistRow, userRow] = await Promise.all([
    pool.query<{ has_play: boolean; max_play_count: string }>(
      `SELECT EXISTS(SELECT 1 FROM user_tag_track_stats WHERE telegram_user_id = $1) AS has_play,
              COALESCE(MAX(play_count), 0) AS max_play_count
       FROM user_tag_track_stats WHERE telegram_user_id = $1`,
      [telegramUserId]
    ),
    pool.query<{ midnight_plays: string }>(
      `SELECT midnight_plays FROM user_tag_stats WHERE telegram_user_id = $1`,
      [telegramUserId]
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM user_tag_listening_days WHERE telegram_user_id = $1`,
      [telegramUserId]
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM user_tag_listened_artists WHERE telegram_user_id = $1`,
      [telegramUserId]
    ),
    pool.query<{ total_listened_seconds: string }>(
      `SELECT total_listened_seconds FROM users WHERE telegram_user_id = $1`,
      [telegramUserId]
    ),
  ]);

  const hasPlay = trackStats.rows[0]?.has_play ?? false;
  const maxPlayCount = Number(trackStats.rows[0]?.max_play_count ?? 0);
  const midnightPlays = Number(midnightRow.rows[0]?.midnight_plays ?? 0);
  const listeningDays = Number(dayRow.rows[0]?.count ?? 0);
  const listenedArtists = Number(artistRow.rows[0]?.count ?? 0);
  const totalListenedSeconds = Number(userRow.rows[0]?.total_listened_seconds ?? 0);

  const unlocks: string[] = [];
  if (hasPlay) unlocks.push("first_spin");
  if (listeningDays >= 7) unlocks.push("regular");
  if (totalListenedSeconds >= 10 * 3600) unlocks.push("deep_listener");
  if (midnightPlays >= 25) unlocks.push("midnight_radio");
  if (maxPlayCount >= 10) unlocks.push("repeat_offender");
  if (maxPlayCount >= 50) unlocks.push("one_song_cult");
  if (maxPlayCount >= 100) unlocks.push("obsessive");
  if (listenedArtists >= 50) unlocks.push("eclectic");

  if (unlocks.length > 0) await unlockTags(telegramUserId, unlocks);
}

/**
 * Updates every durable counter a qualified play feeds, then re-evaluates the
 * listening-category tags. `localMinuteOfDay`/`localDate` are optional and
 * client-supplied (Navaar has no stored per-user timezone) — when absent, the
 * two local-time-dependent tags (Midnight Radio, 4:44 Club) simply aren't
 * evaluated for this play rather than being guessed at from server UTC time.
 *
 * Called once, fire-and-forget, right after recordPlay() successfully inserts
 * a play — never awaited by the request that recorded it.
 */
export async function recordQualifiedListen(
  telegramUserId: number,
  trackId: string,
  opts: { localMinuteOfDay?: number; localDate?: string } = {}
): Promise<void> {
  try {
    const pool = getPool();
    const trackRow = await pool.query<{ artist: string | null }>(
      `SELECT artist FROM tracks WHERE id = $1`,
      [trackId]
    );
    const artist = trackRow.rows[0]?.artist?.trim() || null;

    const prevRow = await pool.query<{ last_played_at: string }>(
      `SELECT last_played_at FROM user_tag_track_stats
       WHERE telegram_user_id = $1 AND track_id = $2`,
      [telegramUserId, trackId]
    );
    const previousLastPlayedAt = prevRow.rows[0]?.last_played_at ?? null;

    await pool.query(
      `INSERT INTO user_tag_track_stats (telegram_user_id, track_id, play_count, first_played_at, last_played_at)
       VALUES ($1, $2, 1, now(), now())
       ON CONFLICT (telegram_user_id, track_id)
       DO UPDATE SET play_count = user_tag_track_stats.play_count + 1, last_played_at = now()`,
      [telegramUserId, trackId]
    );

    const day = opts.localDate ?? new Date().toISOString().slice(0, 10);
    await pool.query(
      `INSERT INTO user_tag_listening_days (telegram_user_id, day) VALUES ($1, $2::date)
       ON CONFLICT DO NOTHING`,
      [telegramUserId, day]
    );

    if (artist) {
      const keys = [...new Set(splitArtists(artist).map(normalizeArtist))];
      if (keys.length > 0) {
        await pool.query(
          `INSERT INTO user_tag_listened_artists (telegram_user_id, artist_key)
           SELECT $1, x FROM unnest($2::text[]) AS x
           ON CONFLICT DO NOTHING`,
          [telegramUserId, keys]
        );
      }
    }

    const minute = opts.localMinuteOfDay;
    const inMidnightWindow =
      typeof minute === "number" && minute >= 0 && minute < MIDNIGHT_WINDOW_END_MINUTE;
    if (inMidnightWindow) {
      await pool.query(
        `INSERT INTO user_tag_stats (telegram_user_id, midnight_plays, updated_at)
         VALUES ($1, 1, now())
         ON CONFLICT (telegram_user_id)
         DO UPDATE SET midnight_plays = user_tag_stats.midnight_plays + 1, updated_at = now()`,
        [telegramUserId]
      );
    }

    const eventUnlocks: string[] = [];

    // Necromancer: this play follows a 90+ day gap since this track's
    // previous play. Only a *previous* play counts — a track's first-ever
    // play is First Spin, not a resurrection.
    if (previousLastPlayedAt) {
      const gapMs = Date.now() - new Date(previousLastPlayedAt).getTime();
      if (gapMs >= 90 * 24 * 60 * 60 * 1000) eventUnlocks.push("necromancer");
    }

    // 4:44 Club: this exact play landed in the recommended window.
    if (typeof minute === "number" && FOUR_FOUR_FOUR_MINUTES.has(minute)) {
      eventUnlocks.push("four_four_four");
    }

    // Rabbit Hole: 12 distinct tracks by this same artist tag, played today.
    // "Today" is short-lived enough that the (90-day, pruned) plays table is
    // always a safe source, so this doesn't need a durable table of its own.
    if (artist) {
      const { rows } = await pool.query<{ count: string }>(
        `SELECT COUNT(DISTINCT p.track_id) AS count
         FROM plays p
         JOIN tracks t ON t.id = p.track_id
         WHERE p.telegram_user_id = $1
           AND LOWER(t.artist) = LOWER($2)
           AND p.played_at >= $3::date
           AND p.played_at < $3::date + interval '1 day'`,
        [telegramUserId, artist, day]
      );
      if (Number(rows[0]?.count ?? 0) >= 12) eventUnlocks.push("rabbit_hole");
    }

    if (eventUnlocks.length > 0) await unlockTags(telegramUserId, eventUnlocks);

    await evaluateListeningTags(telegramUserId);
  } catch (err) {
    console.error("tag evaluation (listening) failed", err);
  }
}

/**
 * The seven library tags, plus the one secret tag (Archivist) whose condition
 * is itself a library aggregate. Reads the owner's whole live library in one
 * query — libraries here run to the hundreds, not millions, so this is
 * cheaper than trying to track distinct-artist/album sets incrementally, and
 * it is only ever called on a track create/save/edit, never on a play.
 */
export async function evaluateLibraryTags(telegramUserId: number): Promise<void> {
  try {
    const { rows } = await getPool().query<{
      artist: string | null;
      album: string | null;
      title: string | null;
      has_cover: boolean;
    }>(
      `SELECT artist, album, title,
              (cover_image IS NOT NULL OR cover_file_id IS NOT NULL) AS has_cover
       FROM tracks
       WHERE owner_telegram_id = $1 AND deleted_at IS NULL`,
      [telegramUserId]
    );

    const total = rows.length;
    const artistKeys = new Set<string>();
    const albumKeys = new Set<string>();
    let coverCount = 0;
    let completeCount = 0;
    for (const row of rows) {
      if (row.artist) for (const a of splitArtists(row.artist)) artistKeys.add(normalizeArtist(a));
      if (row.album && row.album.trim()) albumKeys.add(row.album.trim().toLowerCase());
      if (row.has_cover) coverCount++;
      if (row.title?.trim() && row.artist?.trim() && row.album?.trim()) completeCount++;
    }

    const unlocks: string[] = [];
    if (total >= 25) unlocks.push("crate_digger");
    if (total >= 100) unlocks.push("crate_goblin");
    if (total >= 250) unlocks.push("vault_keeper");
    if (albumKeys.size >= 20) unlocks.push("album_nerd");
    if (artistKeys.size >= 50) unlocks.push("scene_builder");
    if (coverCount >= 10) unlocks.push("art_director");
    // Fixed 50-track minimum so a one-track, perfectly-tagged library can't
    // round up to a 90%+ ratio and unlock this for free.
    if (total >= 50 && completeCount / total >= 0.9) unlocks.push("metadata_police");
    if (total >= 500 && artistKeys.size >= 100) unlocks.push("archivist");

    if (unlocks.length > 0) await unlockTags(telegramUserId, unlocks);
  } catch (err) {
    console.error("tag evaluation (library) failed", err);
  }
}

/**
 * The six playlist tags. Evaluated for a playlist's *owner* — callers that
 * observe a playlist event on someone else's playlist (a follow) must resolve
 * the owner id themselves and pass that, not the acting user's.
 */
export async function evaluatePlaylistTags(telegramUserId: number): Promise<void> {
  try {
    const pool = getPool();
    const [playlistRows, shareRow] = await Promise.all([
      pool.query<{
        visibility: string;
        group_chat_id: string | null;
        track_count: string;
        follower_count: string;
      }>(
        `SELECT p.visibility, p.group_chat_id,
                (SELECT COUNT(*) FROM playlist_tracks pt WHERE pt.playlist_id = p.id) AS track_count,
                (SELECT COUNT(*) FROM playlist_follows pf WHERE pf.playlist_id = p.id) AS follower_count
         FROM playlists p
         WHERE p.owner_telegram_id = $1`,
        [telegramUserId]
      ),
      // Distinct tracks, not raw shares: re-sharing the same track reuses its
      // token (createTrackShare) and must never inflate this count.
      pool.query<{ count: string }>(
        `SELECT COUNT(DISTINCT track_id) AS count FROM track_shares WHERE sender_telegram_id = $1`,
        [telegramUserId]
      ),
    ]);

    const playlists = playlistRows.rows.map((r) => ({
      visibility: r.visibility,
      groupChatId: r.group_chat_id,
      trackCount: Number(r.track_count),
      followerCount: Number(r.follower_count),
    }));

    const unlocks: string[] = [];
    if (playlists.length >= 5) unlocks.push("playlist_architect");
    if (playlists.some((p) => p.trackCount >= 25)) unlocks.push("mixtape_machine");
    // playlist_follows already rejects a self-follow (repo.ts), so every
    // follower counted here is by definition somebody else.
    if (playlists.some((p) => p.followerCount >= 3)) unlocks.push("mixtape_dealer");
    if (playlists.some((p) => p.visibility === "public" && p.followerCount >= 5)) {
      unlocks.push("public_radio");
    }
    if (playlists.some((p) => p.groupChatId && p.trackCount >= 3)) unlocks.push("group_chat_dj");
    if (Number(shareRow.rows[0]?.count ?? 0) >= 10) unlocks.push("track_pusher");

    if (unlocks.length > 0) await unlockTags(telegramUserId, unlocks);
  } catch (err) {
    console.error("tag evaluation (playlists) failed", err);
  }
}

/**
 * The five social tags: First Contact/Social Butterfly/Connector (accepted
 * friendships), Taste Dealer (endorsements received) and The Plug (tracks
 * this user originated that other people have since saved). Bundled into one
 * function since every hook that can move any of them — an accepted friend
 * request, an endorsement, another user's save — is cheap enough to just
 * recheck all five rather than track which single counter moved.
 */
export async function evaluateSocialTags(telegramUserId: number): Promise<void> {
  try {
    const pool = getPool();
    const [friendRow, endorseRow, plugRow] = await Promise.all([
      pool.query<{ count: string }>(
        `SELECT COUNT(*) FROM friendships
         WHERE status = 'accepted' AND (requester_id = $1 OR addressee_id = $1)`,
        [telegramUserId]
      ),
      pool.query<{ count: string }>(
        `SELECT COUNT(*) FROM endorsements WHERE endorsee_id = $1`,
        [telegramUserId]
      ),
      // Other users only, and by distinct track — origin_id is set on the
      // copy at save time and never recomputed, so this stays correct no
      // matter how many hands a track passes through after that.
      pool.query<{ count: string }>(
        `SELECT COUNT(DISTINCT source_track_id) AS count FROM track_saves
         WHERE origin_id = $1 AND saver_id <> $1`,
        [telegramUserId]
      ),
    ]);

    const friends = Number(friendRow.rows[0]?.count ?? 0);
    const endorsements = Number(endorseRow.rows[0]?.count ?? 0);
    const plug = Number(plugRow.rows[0]?.count ?? 0);

    const unlocks: string[] = [];
    if (friends >= 1) unlocks.push("first_contact");
    if (friends >= 5) unlocks.push("social_butterfly");
    if (friends >= 10) unlocks.push("connector");
    if (endorsements >= 3) unlocks.push("taste_dealer");
    if (plug >= 10) unlocks.push("the_plug");

    if (unlocks.length > 0) await unlockTags(telegramUserId, unlocks);
  } catch (err) {
    console.error("tag evaluation (social) failed", err);
  }
}
