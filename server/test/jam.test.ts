/**
 * Jam Mode's authorization and lifecycle. A jam is several people's clients
 * acting on one shared row, so what matters is who may do what to it, that
 * joining alone never hands anybody a track they could not already play —
 * only a song somebody put on the jam, and only while it is there — and that
 * every open state — a request, a guest, the jam itself — closes on its own
 * when time says it should.
 *
 * Runs against a real Postgres, like visibility.test.ts, and skips without
 * TEST_DATABASE_URL. Its fixture ids are a block of their own so its
 * teardown cannot touch another suite's rows.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const ID_BASE = 900_000_000_200;
const ID_END = ID_BASE + 100;
const HOST = ID_BASE + 1;
const G1 = ID_BASE + 2;
const G2 = ID_BASE + 3;
const G3 = ID_BASE + 4;
const G4 = ID_BASE + 5;
const STRANGER = ID_BASE + 6;

type Jam = typeof import("../src/jam");
type Repo = typeof import("../src/repo");
type Db = typeof import("../src/db");

let jam: Jam;
let repo: Repo;
let db: Db;

const tracks = {
  hostShared: randomUUID(),
  hostPrivate: randomUUID(),
  g1Shared: randomUUID(),
  g1Private: randomUUID(),
};

async function seed(): Promise<void> {
  const pool = db.getPool();
  for (const [id, name] of [
    [HOST, "host"],
    [G1, "g1"],
    [G2, "g2"],
    [G3, "g3"],
    [G4, "g4"],
    [STRANGER, "stranger"],
  ] as const) {
    await repo.ensureUser(id, name);
  }

  for (const [key, id, owner] of [
    ["hostShared", tracks.hostShared, HOST],
    ["hostPrivate", tracks.hostPrivate, HOST],
    ["g1Shared", tracks.g1Shared, G1],
    ["g1Private", tracks.g1Private, G1],
  ] as const) {
    await repo.createTrack({
      id,
      ownerTelegramId: owner,
      title: key,
      artist: "fixture",
      album: null,
      durationSeconds: 200,
      telegramFileId: `fixture-${key}`,
      mimeType: "audio/mpeg",
      coverImage: null,
      coverMimeType: null,
      coverFileId: null,
      originAdderId: owner,
    });
  }

  for (const [owner, trackId] of [
    [HOST, tracks.hostShared],
    [G1, tracks.g1Shared],
  ] as const) {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO playlists (owner_telegram_id, name, visibility)
       VALUES ($1, 'shared', 'friends') RETURNING id`,
      [owner]
    );
    await pool.query(
      `INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES ($1, $2, 0)`,
      [rows[0].id, trackId]
    );
  }

  // Everybody is the host's friend; the guests are not each other's.
  for (const guest of [G1, G2, G3, G4]) {
    await pool.query(
      `INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1, $2, 'accepted')`,
      [guest, HOST]
    );
  }
}

async function teardown(): Promise<void> {
  await db
    .getPool()
    .query(`DELETE FROM users WHERE telegram_user_id >= $1 AND telegram_user_id < $2`, [
      ID_BASE,
      ID_END,
    ]);
}

async function resetJams(): Promise<void> {
  const pool = db.getPool();
  const ids = [HOST, G1, G2, G3, G4, STRANGER];
  await pool.query(`DELETE FROM jam_sessions WHERE host_telegram_id = ANY($1)`, [ids]);
  await pool.query(`DELETE FROM jam_join_requests WHERE requester_telegram_id = ANY($1)`, [ids]);
  await repo.setListeningStatus(HOST, tracks.hostShared, 10, true);
}

function unwrap<T>(r: import("../src/jam").JamResult<T>): T {
  if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
  return r.value;
}

/** Ask and be let in, in one step. */
async function join(guest: number): Promise<string> {
  const req = unwrap(await jam.requestJam(guest, HOST));
  return unwrap(await jam.acceptJamRequest(HOST, req.id));
}

describe("jam mode", { skip: TEST_DATABASE_URL ? false : "TEST_DATABASE_URL is not set" }, () => {
  before(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    db = await import("../src/db");
    repo = await import("../src/repo");
    jam = await import("../src/jam");
    const { runMigrations } = await import("../src/migrate");
    await runMigrations();
    await teardown();
    await seed();
  });

  after(async () => {
    await teardown();
    await db.getPool().end();
  });

  describe("live state on a profile", () => {
    before(resetJams);

    test("a friend sees what the host is playing, without a file id", async () => {
      const state = await jam.getLiveState(G1, HOST);
      assert.equal(state.live?.track.id, tracks.hostShared);
      assert.equal(state.live?.is_playing, true);
      assert.equal(state.live?.track.track?.telegram_file_id, "");
    });

    test("a stranger sees nothing", async () => {
      assert.equal((await jam.getLiveState(STRANGER, HOST)).live, null);
    });

    test("a paused listener is not live", async () => {
      await repo.setListeningStatus(HOST, tracks.hostShared, 10, false);
      assert.equal((await jam.getLiveState(G1, HOST)).live, null);
      await repo.setListeningStatus(HOST, tracks.hostShared, 10, true);
    });

    test("a report that has run past the end of its track is not live", async () => {
      await db
        .getPool()
        .query(
          `UPDATE listen_status SET position_at = now() - interval '4 minutes' WHERE telegram_user_id = $1`,
          [HOST]
        );
      assert.equal((await jam.getLiveState(G1, HOST)).live, null);
      await repo.setListeningStatus(HOST, tracks.hostShared, 10, true);
    });

    test("a private listener is not live", async () => {
      const pool = db.getPool();
      await pool.query(`UPDATE listen_status SET is_public = false WHERE telegram_user_id = $1`, [HOST]);
      assert.equal((await jam.getLiveState(G1, HOST)).live, null);
      await pool.query(`UPDATE listen_status SET is_public = true WHERE telegram_user_id = $1`, [HOST]);
    });

    test("a friend with the app open is online without playing anything", async () => {
      await repo.setListeningStatus(HOST, tracks.hostShared, 10, false);
      await repo.touchPresence(HOST);
      const state = await jam.getLiveState(G1, HOST);
      assert.equal(state.live, null);
      assert.equal(state.online, true);
      await repo.setListeningStatus(HOST, tracks.hostShared, 10, true);
    });

    test("a friend who has gone quiet is not online", async () => {
      const pool = db.getPool();
      await repo.setListeningStatus(HOST, tracks.hostShared, 10, false);
      await pool.query(
        `UPDATE users SET last_active_at = now() - interval '10 minutes' WHERE telegram_user_id = $1`,
        [HOST]
      );
      assert.equal((await jam.getLiveState(G1, HOST)).online, false);
      await repo.setListeningStatus(HOST, tracks.hostShared, 10, true);
    });

    test("a stranger never sees somebody online", async () => {
      await repo.touchPresence(HOST);
      assert.equal((await jam.getLiveState(STRANGER, HOST)).online, false);
    });
  });

  describe("requests", () => {
    before(resetJams);

    test("a stranger cannot ask", async () => {
      assert.deepEqual(await jam.requestJam(STRANGER, HOST), { ok: false, error: "not_found" });
    });

    test("nobody can ask to join somebody who is not listening", async () => {
      await repo.setListeningStatus(HOST, null);
      assert.deepEqual(await jam.requestJam(G1, HOST), { ok: false, error: "not_live" });
      await repo.setListeningStatus(HOST, tracks.hostShared, 10, true);
    });

    test("asking twice returns the same request; asking someone else is refused", async () => {
      const first = unwrap(await jam.requestJam(G1, HOST));
      const again = unwrap(await jam.requestJam(G1, HOST));
      assert.equal(again.id, first.id);
      await db
        .getPool()
        .query(
          `INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1, $2, 'accepted')`,
          [G1, G2]
        );
      // G1's shared playlist is now open to G2, so G2 can be live on it.
      assert.equal(await repo.setListeningStatus(G2, tracks.g1Shared, 5, true), true);
      assert.deepEqual(await jam.requestJam(G1, G2), { ok: false, error: "pending_elsewhere" });
      await db
        .getPool()
        .query(`DELETE FROM friendships WHERE requester_id = $1 AND addressee_id = $2`, [G1, G2]);
    });

    test("a waiting requester has no jam and no queue", async () => {
      const state = await jam.getJamState(G1);
      assert.equal(state.jam, null);
      assert.equal(state.outgoing?.status, "pending");
    });

    test("only the host can answer, and the host sees it", async () => {
      const incoming = (await jam.getJamState(HOST)).incoming;
      assert.equal(incoming.length, 1);
      const id = incoming[0].id;
      assert.deepEqual(await jam.acceptJamRequest(G2, id), { ok: false, error: "not_found" });
      assert.deepEqual(await jam.declineJamRequest(STRANGER, id), { ok: false, error: "not_found" });
      assert.deepEqual(await jam.cancelJamRequest(G2, id), { ok: false, error: "not_found" });
    });

    test("a declined request tells the requester and cannot then be accepted", async () => {
      const id = (await jam.getJamState(G1)).outgoing!.id;
      unwrap(await jam.declineJamRequest(HOST, id));
      assert.equal((await jam.getJamState(G1)).outgoing?.status, "declined");
      assert.deepEqual(await jam.acceptJamRequest(HOST, id), { ok: false, error: "gone" });
    });

    test("an unanswered request expires", async () => {
      const req = unwrap(await jam.requestJam(G1, HOST));
      await db
        .getPool()
        .query(`UPDATE jam_join_requests SET expires_at = now() - interval '1 second' WHERE id = $1`, [
          req.id,
        ]);
      assert.equal((await jam.getJamState(G1)).outgoing?.status, "expired");
      assert.deepEqual(await jam.acceptJamRequest(HOST, req.id), { ok: false, error: "gone" });
    });

    test("a cancelled request is gone", async () => {
      const req = unwrap(await jam.requestJam(G1, HOST));
      unwrap(await jam.cancelJamRequest(G1, req.id));
      assert.equal((await jam.getJamState(HOST)).incoming.length, 0);
    });
  });

  describe("a running jam", () => {
    before(resetJams);

    test("accepting starts the jam where the host is", async () => {
      const jamId = await join(G1);
      const host = (await jam.getJamState(HOST)).jam!;
      const guest = (await jam.getJamState(G1)).jam!;
      assert.equal(host.id, jamId);
      assert.equal(host.role, "host");
      assert.equal(guest.role, "guest");
      assert.equal(guest.playback.track?.id, tracks.hostShared);
      assert.ok(guest.playback.position_seconds >= 10);
      assert.equal(guest.participants.length, 2);
    });

    test("the profile says who is jamming, and that the viewer is in it", async () => {
      const state = await jam.getLiveState(G1, HOST);
      assert.equal(state.jam?.role, "host");
      assert.equal(state.jam?.listener_count, 2);
      assert.equal(state.jam?.viewer_is_member, true);
    });

    test("a guest cannot drive playback", async () => {
      assert.deepEqual(
        await jam.syncJam(G1, { trackId: tracks.hostShared, itemId: null, position: 0, playing: true }),
        { ok: false, error: "forbidden" }
      );
    });

    test("what the host plays is shared with the jam while it plays", async () => {
      unwrap(await jam.syncJam(HOST, { trackId: tracks.hostPrivate, itemId: null, position: 3, playing: true }));
      const playback = (await jam.getJamState(G1)).jam!.playback;
      assert.equal(playback.track?.id, tracks.hostPrivate);
      assert.equal(playback.track?.available, true);
      assert.equal(playback.track?.track?.id, tracks.hostPrivate);
      assert.equal(playback.track?.track?.telegram_file_id, "");
      unwrap(await jam.syncJam(HOST, { trackId: tracks.hostShared, itemId: null, position: 3, playing: true }));
    });

    test("the host cannot sync a track they cannot play", async () => {
      assert.deepEqual(
        await jam.syncJam(HOST, { trackId: tracks.g1Private, itemId: null, position: 0, playing: true }),
        { ok: false, error: "forbidden" }
      );
    });

    test("queue: add, duplicate, the adder's own access, and who added it", async () => {
      unwrap(await jam.addToJamQueue(G1, tracks.g1Shared, false));
      assert.deepEqual(await jam.addToJamQueue(G1, tracks.g1Shared, false), {
        ok: false,
        error: "duplicate",
      });
      // Nobody can put on what they could not play themselves.
      assert.deepEqual(await jam.addToJamQueue(G1, tracks.hostPrivate, false), {
        ok: false,
        error: "forbidden",
      });
      assert.deepEqual(await jam.addToJamQueue(STRANGER, tracks.hostShared, false), {
        ok: false,
        error: "not_found",
      });
      unwrap(await jam.addToJamQueue(HOST, tracks.hostShared, true));
      const queue = (await jam.getJamState(HOST)).jam!.queue;
      assert.deepEqual(
        queue.map((i) => [i.track.id, i.added_by.telegram_user_id]),
        [
          [tracks.hostShared, String(HOST)],
          [tracks.g1Shared, String(G1)],
        ]
      );
    });

    test("queue: a guest removes only their own; the host reorders", async () => {
      const queue = (await jam.getJamState(HOST)).jam!.queue;
      const hostItem = queue[0].id;
      const g1Item = queue[1].id;
      assert.deepEqual(await jam.removeFromJamQueue(G1, hostItem), { ok: false, error: "forbidden" });
      assert.deepEqual(await jam.moveJamQueueItem(G1, g1Item, 0), { ok: false, error: "forbidden" });
      unwrap(await jam.moveJamQueueItem(HOST, g1Item, 0));
      assert.equal((await jam.getJamState(G1)).jam!.queue[0].id, g1Item);
      unwrap(await jam.removeFromJamQueue(G1, g1Item));
      unwrap(await jam.removeFromJamQueue(HOST, hostItem));
      assert.equal((await jam.getJamState(HOST)).jam!.queue.length, 0);
    });

    test("a private song on the queue is shared with the jam, and only while it is there", async () => {
      assert.equal(await repo.getTrackForListener(tracks.g1Private, HOST), null);
      unwrap(await jam.addToJamQueue(G1, tracks.g1Private, false));
      const item = (await jam.getJamState(HOST)).jam!.queue[0];
      assert.equal(item.track.available, true);
      assert.ok(await repo.getTrackForListener(tracks.g1Private, HOST));
      assert.equal(await repo.getTrackForListener(tracks.g1Private, STRANGER), null);

      // The host can play it, and anyone in the jam can keep a copy.
      unwrap(await jam.syncJam(HOST, { trackId: tracks.g1Private, itemId: item.id, position: 0, playing: true }));
      const copy = await repo.saveTrackToLibrary(tracks.g1Private, HOST);
      assert.ok(copy);
      assert.equal(copy.track.owner_telegram_id, String(HOST));

      // Once it has moved on, the original is private again; the copy stays.
      unwrap(await jam.syncJam(HOST, { trackId: tracks.hostShared, itemId: null, position: 0, playing: true }));
      assert.equal(await repo.getTrackForListener(tracks.g1Private, HOST), null);
      assert.ok(await repo.getTrackForListener(copy.track.id, HOST));
    });

    test("syncing a queue item consumes it", async () => {
      unwrap(await jam.addToJamQueue(G1, tracks.g1Shared, false));
      const item = (await jam.getJamState(HOST)).jam!.queue[0];
      unwrap(await jam.syncJam(HOST, { trackId: tracks.g1Shared, itemId: item.id, position: 0, playing: true }));
      const state = (await jam.getJamState(G1)).jam!;
      assert.equal(state.queue.length, 0);
      assert.equal(state.playback.item_id, item.id);
    });

    test("the jam holds four and no more", async () => {
      await join(G2);
      await join(G3);
      assert.equal((await jam.getJamState(HOST)).jam!.participants.length, 4);
      assert.deepEqual(await jam.requestJam(G4, HOST), { ok: false, error: "full" });
    });

    test("somebody already in a jam cannot ask into another", async () => {
      assert.deepEqual(await jam.requestJam(G1, HOST), { ok: false, error: "in_jam" });
    });

    test("the host can remove a guest; a guest cannot", async () => {
      assert.deepEqual(await jam.removeJamParticipant(G1, G2), { ok: false, error: "forbidden" });
      unwrap(await jam.removeJamParticipant(HOST, G3));
      assert.equal((await jam.getJamState(G3)).jam, null);
    });

    test("a guest who stops polling drops out", async () => {
      await db
        .getPool()
        .query(
          `UPDATE jam_participants SET last_seen_at = now() - interval '5 minutes'
           WHERE telegram_user_id = $1 AND status = 'active'`,
          [G2]
        );
      await jam.expireJamState();
      assert.equal((await jam.getJamState(HOST)).jam!.participants.length, 2);
    });

    test("the last guest leaving ends it", async () => {
      unwrap(await jam.leaveJam(G1));
      assert.equal((await jam.getJamState(HOST)).jam, null);
      assert.equal((await jam.getJamState(G1)).jam, null);
    });

    test("a host who goes quiet ends the jam for everyone", async () => {
      await join(G1);
      await db
        .getPool()
        .query(
          `UPDATE jam_sessions SET host_seen_at = now() - interval '5 minutes'
           WHERE host_telegram_id = $1 AND status = 'active'`,
          [HOST]
        );
      assert.equal((await jam.getJamState(G1)).jam, null);
      // And the host can start again afterwards.
      await join(G1);
      assert.equal((await jam.getJamState(G1)).jam?.role, "guest");
    });

    test("the host leaving ends the jam", async () => {
      unwrap(await jam.leaveJam(HOST));
      assert.equal((await jam.getJamState(G1)).jam, null);
    });
  });
});
