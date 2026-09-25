import type { Pool, PoolClient } from "pg";
import { getPool, withTransaction } from "./db";
import {
  canSeePerson,
  HAS_COVER_T,
  JAM_HOST_STALE_SECONDS,
  LIVE_T,
  personColumns,
  personFrom,
  PersonSummary,
  TRACK_COLUMNS_T,
  trackCoverVisibleTo,
  trackVisibleTo,
} from "./repo";
import type { Track } from "./types";

/**
 * Jam Mode: listening along with a friend.
 *
 * Nothing here runs on a timer, because nothing on this host can — the
 * instance sleeps after fifteen idle minutes. Every "goes stale", "expires"
 * and "ends" is a timestamp compared against now() by `expireJamState`, which
 * every read and write below calls first. The clients poll on a bounded
 * interval while they are in a jam or waiting on one, so there is always a
 * next read to do the sweeping.
 */

/** A guest not heard from in this long is counted as having left. */
const GUEST_STALE_SECONDS = 120;
/** How long a join request waits for an answer before it lapses. */
const REQUEST_TTL_SECONDS = 120;
/** How long a requester keeps seeing the answer to their request after it lands. */
const OUTGOING_RESULT_SECONDS = 60;
/** Everybody in a jam, host included. */
export const MAX_JAM_LISTENERS = 4;
/** Open items a jam queue will hold. */
const JAM_QUEUE_LIMIT = 50;
/**
 * How recent a listening report must be to count as live on a profile. The
 * player re-posts every two minutes while it plays and on every change, so
 * five minutes is two missed heartbeats.
 */
const LIVE_FRESH_SECONDS = 300;
/**
 * How recent `users.last_active_at` must be to count as online. The client
 * stamps it at sign-in and every minute while the app is on screen, so this is
 * two missed heartbeats and some slack.
 */
const ONLINE_FRESH_SECONDS = 150;
/**
 * How far past a track's end the derived position may run before the report
 * is called stale — covers the gap between one track ending and the next
 * report arriving, and nothing more.
 */
const LIVE_END_GRACE_SECONDS = 30;

type Queryable = Pool | PoolClient;

/** A track as a jam carries it: always nameable, playable only when `available`. */
export interface JamTrack {
  id: string;
  title: string | null;
  artist: string | null;
  duration_seconds: number | null;
  cover_track_id: string | null;
  /**
   * Whether this viewer may play it under the ordinary visibility rules.
   * Joining a jam never widens them: a guest who could not open the track
   * alone gets its name and nothing to stream.
   */
  available: boolean;
  /** The playable track, only when `available`. Never carries a file id. */
  track: Track | null;
}

export interface JamQueueItem {
  id: string;
  track: JamTrack;
  added_by: PersonSummary;
}

export interface JamParticipant {
  person: PersonSummary;
  role: "host" | "guest";
}

export interface JamPlayback {
  track: JamTrack | null;
  /** The queue row being played, when the host took it from the jam queue. */
  item_id: string | null;
  position_seconds: number;
  /** Server time `position_seconds` was true at; the client extrapolates from it. */
  position_at: string;
  is_playing: boolean;
}

export interface JamView {
  id: string;
  role: "host" | "guest";
  host: PersonSummary;
  participants: JamParticipant[];
  playback: JamPlayback;
  queue: JamQueueItem[];
}

export type JamRequestStatus = "pending" | "accepted" | "declined" | "cancelled" | "expired";

export interface JamRequestView {
  id: string;
  status: JamRequestStatus;
  host: PersonSummary;
  requester: PersonSummary;
  created_at: string;
  expires_at: string;
}

/** Everything a client needs to draw its jam state, from one poll. */
export interface JamPoll {
  server_now: string;
  jam: JamView | null;
  /** Requests waiting on the caller, as a host. */
  incoming: JamRequestView[];
  /** The caller's own latest request, while it is open or just answered. */
  outgoing: JamRequestView | null;
}

/** Somebody's listening, as a profile's live player draws it. */
export interface LiveListening {
  track: JamTrack;
  position_seconds: number;
  position_at: string;
  is_playing: boolean;
}

/** The jam a profile's owner is in, as a friend viewing that profile sees it. */
export interface LiveJam {
  id: string;
  /** What the profile's owner is in it. */
  role: "host" | "guest";
  listener_count: number;
  /** Whether the viewer is in this same jam. */
  viewer_is_member: boolean;
  /** Who runs it, when the viewer may see that person. */
  host: PersonSummary | null;
}

export interface LiveState {
  server_now: string;
  /**
   * Has the app open right now: signed in or heartbeating within the online
   * window, or playing something friends can see. Independent of `live`,
   * which needs a track.
   */
  online: boolean;
  live: LiveListening | null;
  jam: LiveJam | null;
}

export type JamError =
  | "not_found"
  | "not_live"
  | "in_jam"
  | "host_busy"
  | "full"
  | "pending_elsewhere"
  | "gone"
  | "forbidden"
  | "duplicate"
  | "queue_full";

export type JamResult<T> = { ok: true; value: T } | { ok: false; error: JamError };

const ok = <T>(value: T): JamResult<T> => ({ ok: true, value });
const fail = <T>(error: JamError): JamResult<T> => ({ ok: false, error });

const FRIENDS = (a: string, b: string) => `EXISTS (
  SELECT 1 FROM friendships f
  WHERE f.status = 'accepted'
    AND ((f.requester_id = ${a} AND f.addressee_id = ${b})
      OR (f.requester_id = ${b} AND f.addressee_id = ${a}))
)`;

/**
 * Close whatever time has closed. Each statement is its own autocommit and
 * idempotent, so two polls sweeping at once only repeat each other's work.
 * The order matters: a stale host ends the jam, a stale guest leaves it, and
 * only then does "nobody left to listen with" get counted.
 */
export async function expireJamState(q: Queryable = getPool()): Promise<void> {
  await q.query(
    `UPDATE jam_sessions SET status = 'ended', ended_at = now()
     WHERE status = 'active' AND host_seen_at < now() - interval '${JAM_HOST_STALE_SECONDS} seconds'`
  );
  await q.query(
    `UPDATE jam_participants SET status = 'left', left_at = now()
     WHERE status = 'active' AND role = 'guest'
       AND last_seen_at < now() - interval '${GUEST_STALE_SECONDS} seconds'`
  );
  // A jam is two or more people; the host alone is just listening.
  await q.query(
    `UPDATE jam_sessions s SET status = 'ended', ended_at = now()
     WHERE s.status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM jam_participants p
         WHERE p.jam_id = s.id AND p.status = 'active' AND p.role = 'guest'
       )`
  );
  await q.query(
    `UPDATE jam_participants p SET status = 'left', left_at = now()
     FROM jam_sessions s
     WHERE s.id = p.jam_id AND s.status = 'ended' AND p.status = 'active'`
  );
  await q.query(
    `UPDATE jam_join_requests SET status = 'expired', resolved_at = now()
     WHERE status = 'pending' AND expires_at < now()`
  );
}

/** The SELECT list for a track as `viewer` sees it inside a jam. */
function jamTrackColumns(viewer: string): string {
  return `${TRACK_COLUMNS_T},
    (${LIVE_T} AND ${trackVisibleTo(viewer, "t")}) AS jt_available,
    CASE WHEN ${LIVE_T} AND ${HAS_COVER_T} AND ${trackCoverVisibleTo(viewer, "t")}
      THEN t.id END AS jt_cover`;
}

function jamTrackFrom(row: Record<string, unknown>, viewerId: number): JamTrack {
  const available = Boolean(row.jt_available);
  const id = String(row.id);
  const owner = String(row.owner_telegram_id);
  return {
    id,
    title: (row.title as string | null) ?? null,
    artist: (row.artist as string | null) ?? null,
    duration_seconds: (row.duration_seconds as number | null) ?? null,
    cover_track_id: (row.jt_cover as string | null) ?? null,
    available,
    track: available
      ? {
          id,
          owner_telegram_id: owner,
          title: (row.title as string | null) ?? null,
          artist: (row.artist as string | null) ?? null,
          album: (row.album as string | null) ?? null,
          duration_seconds: (row.duration_seconds as number | null) ?? null,
          // Streaming goes through /api/tracks/:id/stream, which checks the
          // requester again; the raw Telegram file id never leaves the server.
          telegram_file_id: "",
          mime_type: (row.mime_type as string | null) ?? null,
          has_cover: Boolean(row.has_cover),
          origin_adder_id: row.origin_adder_id == null ? null : String(row.origin_adder_id),
          favorited_at:
            owner === String(viewerId) ? ((row.favorited_at as string | null) ?? null) : null,
          has_lyrics: Boolean(row.has_lyrics),
          created_at: String(row.created_at),
        }
      : null,
  };
}

/** The caller's active jam membership, if any. */
async function membershipOf(
  q: Queryable,
  userId: number
): Promise<{ jam_id: string; role: "host" | "guest" } | null> {
  const { rows } = await q.query<{ jam_id: string; role: "host" | "guest" }>(
    `SELECT p.jam_id, p.role
     FROM jam_participants p
     JOIN jam_sessions s ON s.id = p.jam_id AND s.status = 'active'
     WHERE p.telegram_user_id = $1 AND p.status = 'active'`,
    [userId]
  );
  return rows[0] ?? null;
}

async function loadJamView(
  q: Queryable,
  viewerId: number,
  jamId: string,
  role: "host" | "guest"
): Promise<JamView | null> {
  const session = await q.query<Record<string, unknown>>(
    `SELECT s.id, s.current_item_id, s.position_seconds, s.position_at, s.is_playing,
       ${personColumns("h", "host")}
     FROM jam_sessions s
     JOIN users h ON h.telegram_user_id = s.host_telegram_id
     WHERE s.id = $1 AND s.status = 'active'`,
    [jamId]
  );
  const s = session.rows[0];
  if (!s) return null;

  const [participants, current, queue] = await Promise.all([
    q.query<Record<string, unknown>>(
      `SELECT p.role, ${personColumns("u", "person")}
       FROM jam_participants p
       JOIN users u ON u.telegram_user_id = p.telegram_user_id
       WHERE p.jam_id = $1 AND p.status = 'active'
       ORDER BY (p.role = 'host') DESC, p.joined_at`,
      [jamId]
    ),
    q.query<Record<string, unknown>>(
      `SELECT ${jamTrackColumns("$2")}
       FROM jam_sessions s JOIN tracks t ON t.id = s.current_track_id
       WHERE s.id = $1`,
      [jamId, viewerId]
    ),
    q.query<Record<string, unknown>>(
      `SELECT jq.id AS item_id, ${jamTrackColumns("$2")}, ${personColumns("a", "adder")}
       FROM jam_queue jq
       JOIN tracks t ON t.id = jq.track_id AND ${LIVE_T}
       JOIN users a ON a.telegram_user_id = jq.added_by
       WHERE jq.jam_id = $1 AND jq.status = 'queued'
       ORDER BY jq.position, jq.created_at`,
      [jamId, viewerId]
    ),
  ]);

  return {
    id: String(s.id),
    role,
    host: personFrom(s, "host")!,
    participants: participants.rows.map((r) => ({
      person: personFrom(r, "person")!,
      role: r.role as "host" | "guest",
    })),
    playback: {
      track: current.rows[0] ? jamTrackFrom(current.rows[0], viewerId) : null,
      item_id: (s.current_item_id as string | null) ?? null,
      position_seconds: Number(s.position_seconds),
      position_at: new Date(s.position_at as string).toISOString(),
      is_playing: Boolean(s.is_playing),
    },
    queue: queue.rows.map((r) => ({
      id: String(r.item_id),
      track: jamTrackFrom(r, viewerId),
      added_by: personFrom(r, "adder")!,
    })),
  };
}

const REQUEST_SELECT = `
  SELECT r.id, r.status, r.created_at, r.expires_at,
    ${personColumns("h", "host")}, ${personColumns("rq", "req")}
  FROM jam_join_requests r
  JOIN users h ON h.telegram_user_id = r.host_telegram_id
  JOIN users rq ON rq.telegram_user_id = r.requester_telegram_id`;

function requestFrom(row: Record<string, unknown>): JamRequestView {
  return {
    id: String(row.id),
    status: row.status as JamRequestStatus,
    host: personFrom(row, "host")!,
    requester: personFrom(row, "req")!,
    created_at: new Date(row.created_at as string).toISOString(),
    expires_at: new Date(row.expires_at as string).toISOString(),
  };
}

/**
 * The poll. Also the heartbeat: reading it is what tells the server the
 * caller is still here, so a host or guest who stops polling drops out on
 * their own after the stale window.
 */
export async function getJamState(viewerId: number): Promise<JamPoll> {
  const pool = getPool();
  await expireJamState(pool);

  const touched = await pool.query<{ jam_id: string; role: "host" | "guest" }>(
    `UPDATE jam_participants p SET last_seen_at = now()
     FROM jam_sessions s
     WHERE s.id = p.jam_id AND s.status = 'active'
       AND p.telegram_user_id = $1 AND p.status = 'active'
     RETURNING p.jam_id, p.role`,
    [viewerId]
  );
  const member = touched.rows[0] ?? null;
  if (member?.role === "host") {
    await pool.query(`UPDATE jam_sessions SET host_seen_at = now() WHERE id = $1`, [
      member.jam_id,
    ]);
  }

  const [jam, incoming, outgoing, now] = await Promise.all([
    member ? loadJamView(pool, viewerId, member.jam_id, member.role) : Promise.resolve(null),
    // A request from somebody who has since stopped being a friend is not
    // shown: accepting it would be refused anyway.
    pool.query<Record<string, unknown>>(
      `${REQUEST_SELECT}
       WHERE r.host_telegram_id = $1 AND r.status = 'pending'
         AND ${FRIENDS("r.host_telegram_id", "r.requester_telegram_id")}
       ORDER BY r.created_at`,
      [viewerId]
    ),
    pool.query<Record<string, unknown>>(
      `${REQUEST_SELECT}
       WHERE r.requester_telegram_id = $1
         AND (r.status = 'pending'
           OR r.resolved_at > now() - interval '${OUTGOING_RESULT_SECONDS} seconds')
       ORDER BY r.created_at DESC
       LIMIT 1`,
      [viewerId]
    ),
    pool.query<{ now: Date }>(`SELECT now() AS now`),
  ]);

  return {
    server_now: now.rows[0].now.toISOString(),
    jam,
    incoming: incoming.rows.map(requestFrom),
    outgoing: outgoing.rows[0] ? requestFrom(outgoing.rows[0]) : null,
  };
}

/**
 * The listening-status predicate a live player on a profile stands on:
 * public, playing, recently reported, and not already past the end of the
 * track it claims — so a phone that died mid-song stops looking live on its
 * own rather than showing a player frozen at 3:12 forever.
 */
function liveClause(ls: string): string {
  return `(
    ${ls}.is_public AND ${ls}.is_playing AND ${ls}.position_at IS NOT NULL
    AND ${ls}.updated_at > now() - interval '${LIVE_FRESH_SECONDS} seconds'
    AND ${LIVE_T}
    AND (t.duration_seconds IS NULL
      OR ${ls}.position_seconds + EXTRACT(EPOCH FROM now() - ${ls}.position_at)
         <= t.duration_seconds + ${LIVE_END_GRACE_SECONDS})
  )`;
}

/**
 * What a profile's live player shows. Friends only: the same line
 * `listFriendsListening` already draws, since the live card is that
 * information with a progress bar on it.
 */
export async function getLiveState(viewerId: number, targetId: number): Promise<LiveState> {
  const pool = getPool();
  const nowRow = await pool.query<{ now: Date }>(`SELECT now() AS now`);
  const server_now = nowRow.rows[0].now.toISOString();
  const none: LiveState = { server_now, online: false, live: null, jam: null };
  if (viewerId === targetId) return none;

  const friends = await pool.query<{ ok: boolean; online: boolean | null }>(
    `SELECT ${FRIENDS("$1", "$2")} AS ok,
       (SELECT u.last_active_at > now() - interval '${ONLINE_FRESH_SECONDS} seconds'
        FROM users u WHERE u.telegram_user_id = $2) AS online`,
    [viewerId, targetId]
  );
  if (!friends.rows[0]?.ok) return none;

  await expireJamState(pool);

  const [live, jam] = await Promise.all([
    pool.query<Record<string, unknown>>(
      `SELECT ${jamTrackColumns("$1")},
         ls.position_seconds, ls.position_at, ls.is_playing
       FROM listen_status ls
       JOIN tracks t ON t.id = ls.track_id
       WHERE ls.telegram_user_id = $2 AND ${liveClause("ls")}`,
      [viewerId, targetId]
    ),
    pool.query<Record<string, unknown>>(
      `SELECT s.id, p.role,
         (SELECT count(*)::int FROM jam_participants x
          WHERE x.jam_id = s.id AND x.status = 'active') AS listener_count,
         EXISTS (SELECT 1 FROM jam_participants v
                 WHERE v.jam_id = s.id AND v.status = 'active'
                   AND v.telegram_user_id = $1) AS viewer_is_member,
         CASE WHEN ${canSeePerson("$1", "s.host_telegram_id")} THEN h.telegram_user_id END AS host_id,
         h.username AS host_username, h.handle AS host_handle,
         (h.avatar_file_id IS NOT NULL) AS host_has_avatar
       FROM jam_participants p
       JOIN jam_sessions s ON s.id = p.jam_id AND s.status = 'active'
       JOIN users h ON h.telegram_user_id = s.host_telegram_id
       WHERE p.telegram_user_id = $2 AND p.status = 'active'`,
      [viewerId, targetId]
    ),
  ]);

  const l = live.rows[0];
  const j = jam.rows[0];
  return {
    server_now,
    // Somebody playing in the background with the app hidden has stopped
    // heartbeating, but is plainly still around.
    online: Boolean(friends.rows[0].online) || l != null,
    live: l
      ? {
          track: jamTrackFrom(l, viewerId),
          position_seconds: Number(l.position_seconds),
          position_at: new Date(l.position_at as string).toISOString(),
          is_playing: Boolean(l.is_playing),
        }
      : null,
    jam: j
      ? {
          id: String(j.id),
          role: j.role as "host" | "guest",
          listener_count: Number(j.listener_count),
          viewer_is_member: Boolean(j.viewer_is_member),
          host: personFrom(j, "host"),
        }
      : null,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string }).code === "23505";
}

/**
 * Ask to join a friend's listening. Addressed to the person, not to a jam:
 * the first accepted request is what creates one.
 */
export async function requestJam(
  requesterId: number,
  hostId: number
): Promise<JamResult<JamRequestView>> {
  const pool = getPool();
  if (requesterId === hostId) return fail("forbidden");

  const friends = await pool.query<{ ok: boolean }>(`SELECT ${FRIENDS("$1", "$2")} AS ok`, [
    requesterId,
    hostId,
  ]);
  if (!friends.rows[0]?.ok) return fail("not_found");

  await expireJamState(pool);

  if (await membershipOf(pool, requesterId)) return fail("in_jam");

  const hostMember = await membershipOf(pool, hostId);
  if (hostMember?.role === "guest") return fail("host_busy");
  if (hostMember) {
    const count = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM jam_participants WHERE jam_id = $1 AND status = 'active'`,
      [hostMember.jam_id]
    );
    if (count.rows[0].n >= MAX_JAM_LISTENERS) return fail("full");
  } else {
    const live = await pool.query(
      `SELECT 1 FROM listen_status ls JOIN tracks t ON t.id = ls.track_id
       WHERE ls.telegram_user_id = $1 AND ${liveClause("ls")}`,
      [hostId]
    );
    if (live.rowCount === 0) return fail("not_live");
  }

  // Asking the same person twice is the same request, not a conflict.
  const existing = await pool.query<Record<string, unknown>>(
    `${REQUEST_SELECT}
     WHERE r.requester_telegram_id = $1 AND r.status = 'pending'`,
    [requesterId]
  );
  if (existing.rows[0]) {
    const view = requestFrom(existing.rows[0]);
    return view.host.telegram_user_id === String(hostId) ? ok(view) : fail("pending_elsewhere");
  }

  try {
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO jam_join_requests (host_telegram_id, requester_telegram_id, expires_at)
       VALUES ($1, $2, now() + interval '${REQUEST_TTL_SECONDS} seconds')
       RETURNING id`,
      [hostId, requesterId]
    );
    const row = await pool.query<Record<string, unknown>>(`${REQUEST_SELECT} WHERE r.id = $1`, [
      inserted.rows[0].id,
    ]);
    return ok(requestFrom(row.rows[0]));
  } catch (err) {
    if (isUniqueViolation(err)) return fail("pending_elsewhere");
    throw err;
  }
}

/** The requester takes their request back. */
export async function cancelJamRequest(
  requesterId: number,
  requestId: string
): Promise<JamResult<null>> {
  const { rowCount } = await getPool().query(
    `UPDATE jam_join_requests SET status = 'cancelled', resolved_at = now()
     WHERE id = $1 AND requester_telegram_id = $2 AND status = 'pending'`,
    [requestId, requesterId]
  );
  return rowCount ? ok(null) : fail("not_found");
}

export async function declineJamRequest(
  hostId: number,
  requestId: string
): Promise<JamResult<null>> {
  const { rowCount } = await getPool().query(
    `UPDATE jam_join_requests SET status = 'declined', resolved_at = now()
     WHERE id = $1 AND host_telegram_id = $2 AND status = 'pending'`,
    [requestId, hostId]
  );
  return rowCount ? ok(null) : fail("not_found");
}

/**
 * Let somebody in. One transaction, holding the host's own users row, so two
 * accepts tapped at once cannot both see room for one more listener or both
 * create a jam.
 */
export async function acceptJamRequest(
  hostId: number,
  requestId: string
): Promise<JamResult<string>> {
  await expireJamState();
  try {
    return await withTransaction(async (c) => {
      await c.query(`SELECT 1 FROM users WHERE telegram_user_id = $1 FOR UPDATE`, [hostId]);

      const req = await c.query<{ requester_telegram_id: string; status: string }>(
        `SELECT requester_telegram_id, status FROM jam_join_requests
         WHERE id = $1 AND host_telegram_id = $2 FOR UPDATE`,
        [requestId, hostId]
      );
      const r = req.rows[0];
      if (!r) return fail<string>("not_found");
      if (r.status !== "pending") return fail<string>("gone");
      const requesterId = Number(r.requester_telegram_id);

      const resolve = (status: JamRequestStatus, jamId: string | null = null) =>
        c.query(
          `UPDATE jam_join_requests SET status = $2, jam_id = $3, resolved_at = now() WHERE id = $1`,
          [requestId, status, jamId]
        );

      const friends = await c.query<{ ok: boolean }>(`SELECT ${FRIENDS("$1", "$2")} AS ok`, [
        hostId,
        requesterId,
      ]);
      if (!friends.rows[0]?.ok) {
        await resolve("expired");
        return fail<string>("not_found");
      }

      const hostMember = await membershipOf(c, hostId);
      if (hostMember?.role === "guest") return fail<string>("host_busy");

      // Somebody already in a jam — their own, or yours — cannot be let into
      // this one; the request lapses so their waiting sheet closes.
      if (await membershipOf(c, requesterId)) {
        await resolve("expired");
        return fail<string>("in_jam");
      }

      let jamId = hostMember?.jam_id ?? null;
      if (!jamId) {
        // The jam starts where the host is: the same track, at the same
        // point, playing or not, as their last report said.
        const created = await c.query<{ id: string }>(
          `INSERT INTO jam_sessions
             (host_telegram_id, current_track_id, position_seconds, position_at, is_playing)
           SELECT $1::bigint,
             ls.track_id,
             COALESCE(ls.position_seconds
               + CASE WHEN ls.is_playing
                   THEN EXTRACT(EPOCH FROM now() - ls.position_at) ELSE 0 END, 0),
             now(),
             COALESCE(ls.is_playing, false)
           FROM (SELECT 1) one
           LEFT JOIN listen_status ls
             ON ls.telegram_user_id = $1
            AND ls.updated_at > now() - interval '${LIVE_FRESH_SECONDS} seconds'
           RETURNING id`,
          [hostId]
        );
        jamId = created.rows[0].id;
        await c.query(
          `INSERT INTO jam_participants (jam_id, telegram_user_id, role) VALUES ($1, $2, 'host')`,
          [jamId, hostId]
        );
      } else {
        const count = await c.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM jam_participants WHERE jam_id = $1 AND status = 'active'`,
          [jamId]
        );
        if (count.rows[0].n >= MAX_JAM_LISTENERS) return fail<string>("full");
      }

      await c.query(
        `INSERT INTO jam_participants (jam_id, telegram_user_id, role)
         VALUES ($1, $2, 'guest')
         ON CONFLICT (jam_id, telegram_user_id) DO UPDATE
           SET status = 'active', left_at = NULL, joined_at = now(), last_seen_at = now()`,
        [jamId, requesterId]
      );
      await c.query(`UPDATE jam_sessions SET host_seen_at = now() WHERE id = $1`, [jamId]);
      // A host is not also waiting to be somebody else's guest.
      await c.query(
        `UPDATE jam_join_requests SET status = 'cancelled', resolved_at = now()
         WHERE requester_telegram_id = $1 AND status = 'pending'`,
        [hostId]
      );
      await resolve("accepted", jamId);
      return ok(jamId);
    });
  } catch (err) {
    // The one-active-jam-per-person index caught a race the reads above
    // could not: the requester got into another jam in the same instant.
    if (isUniqueViolation(err)) return fail("in_jam");
    throw err;
  }
}

export interface JamSync {
  trackId: string | null;
  itemId: string | null;
  position: number;
  playing: boolean;
}

/**
 * The host says where playback is. The only writer of a jam's playback
 * columns, and it only ever accepts a track the host may play themselves.
 */
export async function syncJam(hostId: number, sync: JamSync): Promise<JamResult<null>> {
  const pool = getPool();
  await expireJamState(pool);
  const member = await membershipOf(pool, hostId);
  if (!member) return fail("not_found");
  if (member.role !== "host") return fail("forbidden");

  if (sync.trackId) {
    const visible = await pool.query(
      `SELECT 1 FROM tracks t WHERE t.id = $1 AND ${LIVE_T} AND ${trackVisibleTo("$2", "t")}`,
      [sync.trackId, hostId]
    );
    if (visible.rowCount === 0) return fail("forbidden");
  }

  let itemId: string | null = null;
  if (sync.itemId && sync.trackId) {
    // Playing a queue item is what consumes it. An id that is not this jam's,
    // or not for this track, is ignored rather than trusted.
    const item = await pool.query<{ id: string }>(
      `UPDATE jam_queue SET status = CASE WHEN status = 'queued' THEN 'played' ELSE status END
       WHERE id = $1 AND jam_id = $2 AND track_id = $3
       RETURNING id`,
      [sync.itemId, member.jam_id, sync.trackId]
    );
    itemId = item.rows[0]?.id ?? null;
  }

  await pool.query(
    `UPDATE jam_sessions
     SET current_track_id = $2, current_item_id = $3, position_seconds = $4,
         position_at = now(), is_playing = $5, host_seen_at = now()
     WHERE id = $1`,
    [member.jam_id, sync.trackId, itemId, sync.position, sync.playing]
  );
  return ok(null);
}

/** A guest walks out; a host leaving ends the jam for everyone. */
export async function leaveJam(userId: number): Promise<JamResult<null>> {
  const pool = getPool();
  const member = await membershipOf(pool, userId);
  if (!member) return ok(null);
  if (member.role === "host") {
    await pool.query(
      `UPDATE jam_sessions SET status = 'ended', ended_at = now() WHERE id = $1 AND status = 'active'`,
      [member.jam_id]
    );
  } else {
    await pool.query(
      `UPDATE jam_participants SET status = 'left', left_at = now()
       WHERE jam_id = $1 AND telegram_user_id = $2 AND status = 'active'`,
      [member.jam_id, userId]
    );
  }
  await expireJamState(pool);
  return ok(null);
}

export async function removeJamParticipant(
  hostId: number,
  targetId: number
): Promise<JamResult<null>> {
  const pool = getPool();
  const member = await membershipOf(pool, hostId);
  if (!member || member.role !== "host") return fail("forbidden");
  const { rowCount } = await pool.query(
    `UPDATE jam_participants SET status = 'removed', left_at = now()
     WHERE jam_id = $1 AND telegram_user_id = $2 AND role = 'guest' AND status = 'active'`,
    [member.jam_id, targetId]
  );
  if (!rowCount) return fail("not_found");
  await expireJamState(pool);
  return ok(null);
}

/**
 * Put a track on the shared queue. It only has to be one the adder may play:
 * once it is on, `trackVisibleTo` lets everyone in the jam — the host, whose
 * client starts it, included — play it and keep a copy, for as long as it is
 * queued or playing and they are still in the jam.
 */
export async function addToJamQueue(
  userId: number,
  trackId: string,
  next: boolean
): Promise<JamResult<null>> {
  await expireJamState();
  return withTransaction(async (c) => {
    const member = await membershipOf(c, userId);
    if (!member) return fail<null>("not_found");
    await c.query(`SELECT 1 FROM jam_sessions WHERE id = $1 FOR UPDATE`, [member.jam_id]);

    const visible = await c.query(
      `SELECT 1 FROM tracks t
       WHERE t.id = $1 AND ${LIVE_T}
         AND ${trackVisibleTo("$2", "t")}`,
      [trackId, userId]
    );
    if (visible.rowCount === 0) return fail<null>("forbidden");

    const open = await c.query<{ n: number; dup: boolean; lo: number | null; hi: number | null }>(
      `SELECT count(*)::int AS n, bool_or(track_id = $2) AS dup,
         min(position) AS lo, max(position) AS hi
       FROM jam_queue WHERE jam_id = $1 AND status = 'queued'`,
      [member.jam_id, trackId]
    );
    const o = open.rows[0];
    if (o.dup) return fail<null>("duplicate");
    if (o.n >= JAM_QUEUE_LIMIT) return fail<null>("queue_full");

    // Only the host can cut the line.
    const position =
      next && member.role === "host" ? (o.lo ?? 0) - 1 : (o.hi ?? -1) + 1;
    await c.query(
      `INSERT INTO jam_queue (jam_id, track_id, added_by, position) VALUES ($1, $2, $3, $4)`,
      [member.jam_id, trackId, userId, position]
    );
    return ok(null);
  });
}

/** The host can take anything off; a guest only what they put on. */
export async function removeFromJamQueue(
  userId: number,
  itemId: string
): Promise<JamResult<null>> {
  const pool = getPool();
  const member = await membershipOf(pool, userId);
  if (!member) return fail("not_found");
  const { rowCount } = await pool.query(
    `UPDATE jam_queue SET status = 'removed'
     WHERE id = $1 AND jam_id = $2 AND status = 'queued'
       AND ($3 OR added_by = $4)`,
    [itemId, member.jam_id, member.role === "host", userId]
  );
  if (rowCount) return ok(null);
  const exists = await pool.query(
    `SELECT 1 FROM jam_queue WHERE id = $1 AND jam_id = $2 AND status = 'queued'`,
    [itemId, member.jam_id]
  );
  return fail(exists.rowCount ? "forbidden" : "not_found");
}

/** Host only: move one open item to a new place, renumbering the rest. */
export async function moveJamQueueItem(
  hostId: number,
  itemId: string,
  toIndex: number
): Promise<JamResult<null>> {
  return withTransaction(async (c) => {
    const member = await membershipOf(c, hostId);
    if (!member || member.role !== "host") return fail<null>("forbidden");
    await c.query(`SELECT 1 FROM jam_sessions WHERE id = $1 FOR UPDATE`, [member.jam_id]);
    const { rows } = await c.query<{ id: string }>(
      `SELECT id FROM jam_queue WHERE jam_id = $1 AND status = 'queued'
       ORDER BY position, created_at`,
      [member.jam_id]
    );
    const ids = rows.map((r) => r.id);
    const from = ids.indexOf(itemId);
    if (from < 0) return fail<null>("not_found");
    ids.splice(from, 1);
    ids.splice(Math.max(0, Math.min(toIndex, ids.length)), 0, itemId);
    await c.query(
      `UPDATE jam_queue q SET position = o.ord - 1
       FROM unnest($1::uuid[]) WITH ORDINALITY AS o(id, ord)
       WHERE q.id = o.id`,
      [ids]
    );
    return ok(null);
  });
}
