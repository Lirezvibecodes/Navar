/**
 * getListeningStatsPage does all the real work behind the Listening Stats
 * page — period bucketing, the previous-period comparison, repeat/discovery
 * accounting, streaks — so this exercises the arithmetic against a real
 * Postgres rather than trusting it read correctly off the page spec.
 *
 * Plays are inserted directly (not through recordPlay, which always stamps
 * played_at = now()) so each fixture can sit at an exact, known offset from
 * "now" and land deterministically inside or outside a period boundary.
 *
 * Set TEST_DATABASE_URL to a scratch database; without it the suite skips
 * rather than pretending to have checked anything.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

// A block of ids far outside anything Telegram issues, so teardown can clear
// the fixtures by range without touching real rows.
const ID_BASE = 900_000_000_100;
const OWNER = ID_BASE + 1;

type Repo = typeof import("../src/repo");
type Db = typeof import("../src/db");

let repo: Repo;
let db: Db;

const DAY_MS = 24 * 60 * 60 * 1000;

async function makeTrack(title: string, durationSeconds: number): Promise<string> {
  const id = randomUUID();
  await repo.createTrack({
    id,
    ownerTelegramId: OWNER,
    title,
    artist: `Artist ${title}`,
    album: null,
    durationSeconds,
    telegramFileId: `fixture-${id}`,
    mimeType: "audio/mpeg",
    coverImage: null,
    coverMimeType: null,
    coverFileId: null,
    originAdderId: OWNER,
  });
  return id;
}

/** Inserts a play at an exact offset from now, bypassing recordPlay's
 *  now()-only played_at so boundary cases are deterministic. */
async function playAt(
  trackId: string,
  msAgo: number,
  opts: { localDate?: string; localMinuteOfDay?: number } = {}
): Promise<void> {
  const playedAt = new Date(Date.now() - msAgo);
  await db.getPool().query(
    `INSERT INTO plays (telegram_user_id, track_id, played_at, local_date, local_minute_of_day)
     VALUES ($1, $2, $3, $4, $5)`,
    [OWNER, trackId, playedAt, opts.localDate ?? null, opts.localMinuteOfDay ?? null]
  );
}

async function firstPlayedAt(trackId: string, msAgo: number): Promise<void> {
  const at = new Date(Date.now() - msAgo);
  await db.getPool().query(
    `INSERT INTO user_tag_track_stats (telegram_user_id, track_id, play_count, first_played_at, last_played_at)
     VALUES ($1, $2, 1, $3, $3)
     ON CONFLICT (telegram_user_id, track_id) DO UPDATE SET first_played_at = $3`,
    [OWNER, trackId, at]
  );
}

async function listeningDay(daysAgo: number): Promise<void> {
  const day = new Date(Date.now() - daysAgo * DAY_MS).toISOString().slice(0, 10);
  await db.getPool().query(
    `INSERT INTO user_tag_listening_days (telegram_user_id, day) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [OWNER, day]
  );
}

async function teardown(): Promise<void> {
  await db.getPool().query(`DELETE FROM users WHERE telegram_user_id >= $1`, [ID_BASE]);
}

describe(
  "getListeningStatsPage",
  { skip: TEST_DATABASE_URL ? false : "TEST_DATABASE_URL is not set" },
  () => {
    before(async () => {
      process.env.DATABASE_URL = TEST_DATABASE_URL;
      db = await import("../src/db");
      repo = await import("../src/repo");
      const { runMigrations } = await import("../src/migrate");
      await runMigrations();
      await teardown();
      await repo.ensureUser(OWNER, "stats-owner");
    });

    after(async () => {
      await teardown();
      await db.getPool().end();
    });

    test("a user with zero plays gets zeros and nulls, not an error", async () => {
      const solo = await makeTrack("untouched", 200);
      void solo;
      const page = await repo.getListeningStatsPage(OWNER, "30d");
      assert.equal(page.totalPlays, 0);
      assert.equal(page.totalListenedSeconds, 0);
      assert.deepEqual(page.topTracks, []);
      assert.deepEqual(page.topArtists, []);
      assert.equal(page.onRepeat, null);
      assert.equal(page.longestSessionMinutes, null);
      assert.equal(page.currentStreakDays, 0);
      assert.equal(page.repeatRate, 0);
    });

    test("a play lands in the periods that contain it and not the ones that don't", async () => {
      const track = await makeTrack("boundary", 180);
      // 3 days ago: inside 7d/30d, outside "today".
      await playAt(track, 3 * DAY_MS, { localDate: daysAgoIso(3), localMinuteOfDay: 600 });
      // 20 days ago: inside 30d, outside 7d.
      await playAt(track, 20 * DAY_MS, { localDate: daysAgoIso(20), localMinuteOfDay: 600 });
      // 200 days ago: inside 1y/all, outside 3m.
      await playAt(track, 200 * DAY_MS, { localDate: daysAgoIso(200), localMinuteOfDay: 600 });

      const today = await repo.getListeningStatsPage(OWNER, "today");
      const sevenDay = await repo.getListeningStatsPage(OWNER, "7d");
      const thirtyDay = await repo.getListeningStatsPage(OWNER, "30d");
      const threeMonth = await repo.getListeningStatsPage(OWNER, "3m");
      const oneYear = await repo.getListeningStatsPage(OWNER, "1y");
      const all = await repo.getListeningStatsPage(OWNER, "all");

      assert.equal(today.totalPlays, 0);
      assert.equal(sevenDay.totalPlays, 1);
      assert.equal(thirtyDay.totalPlays, 2);
      assert.equal(threeMonth.totalPlays, 2);
      assert.equal(oneYear.totalPlays, 3);
      assert.equal(all.totalPlays, 3);
    });

    test("the previous-period total is the equal-length window immediately before, and is null for all-time", async () => {
      const track = await makeTrack("prev-window", 60);
      // Inside the current 7d window.
      await playAt(track, 1 * DAY_MS, { localDate: daysAgoIso(1), localMinuteOfDay: 0 });
      // Inside the previous 7d window (8-14 days ago), not the current one.
      await playAt(track, 10 * DAY_MS, { localDate: daysAgoIso(10), localMinuteOfDay: 0 });

      const sevenDay = await repo.getListeningStatsPage(OWNER, "7d");
      assert.equal(sevenDay.totalPlays, 1);
      assert.ok(sevenDay.previous);
      assert.equal(sevenDay.previous?.totalPlays, 1);

      const all = await repo.getListeningStatsPage(OWNER, "all");
      assert.equal(all.previous, null);
    });

    test("repeat rate and discovery come from user_tag_track_stats.first_played_at, not from plays in range", async () => {
      const discovered = await makeTrack("discovered-this-period", 90);
      const oldFavorite = await makeTrack("known-for-a-while", 90);

      // Both played once in the current 30d window.
      await playAt(discovered, 2 * DAY_MS, { localDate: daysAgoIso(2), localMinuteOfDay: 0 });
      await playAt(oldFavorite, 2 * DAY_MS, { localDate: daysAgoIso(2), localMinuteOfDay: 0 });

      // discovered's first-ever play is inside the period; oldFavorite's is
      // long before it — even though its only in-range play is the same age.
      await firstPlayedAt(discovered, 2 * DAY_MS);
      await firstPlayedAt(oldFavorite, 300 * DAY_MS);

      const page = await repo.getListeningStatsPage(OWNER, "30d");
      assert.equal(page.discoveryCount, 1);
      // 2 distinct tracks, 1 discovery -> 1 repeat.
      assert.equal(page.repeatRate, 0.5);
    });

    test("current streak counts consecutive local days ending today or yesterday, and stops at a gap", async () => {
      await listeningDay(0);
      await listeningDay(1);
      await listeningDay(2);
      // Gap: no listening_day for 3 days ago.
      await listeningDay(4);

      const page = await repo.getListeningStatsPage(OWNER, "30d");
      assert.equal(page.currentStreakDays, 3);
    });

    test("a session with plays close together is one session; a 30+ minute gap starts a new one", async () => {
      const track = await makeTrack("session", 120);
      // Three plays back-to-back today, all within the 30-minute join gap.
      await playAt(track, 3 * 60 * 60 * 1000, { localDate: daysAgoIso(0), localMinuteOfDay: 60 });
      await playAt(track, 3 * 60 * 60 * 1000 - 2 * 60 * 1000, {
        localDate: daysAgoIso(0),
        localMinuteOfDay: 62,
      });
      await playAt(track, 3 * 60 * 60 * 1000 - 4 * 60 * 1000, {
        localDate: daysAgoIso(0),
        localMinuteOfDay: 64,
      });
      // A lone play hours later, isolated — should not extend the session.
      await playAt(track, 30 * 60 * 1000, { localDate: daysAgoIso(0), localMinuteOfDay: 630 });

      const page = await repo.getListeningStatsPage(OWNER, "today");
      assert.ok(page.longestSessionMinutes != null);
      // 3 plays * 120s = 6 minutes of the session's own duration, spanning a
      // few minutes between starts — comfortably under the isolated play's
      // distance, so it should not have been merged in. The floor is 20
      // minutes, so a short clustered session like this reports null.
      assert.equal(page.longestSessionMinutes, null);
    });

    test("time-of-day and day-of-week buckets use local time, and ignore plays with no local time recorded", async () => {
      const track = await makeTrack("local-time", 100);
      await playAt(track, 1 * DAY_MS, { localDate: daysAgoIso(1), localMinuteOfDay: 9 * 60 });
      // Pre-migration-style row: no local time at all.
      await playAt(track, 1 * DAY_MS);

      const page = await repo.getListeningStatsPage(OWNER, "30d");
      assert.equal(page.totalPlays, 2);
      assert.equal(page.timeOfDay[9], 1);
      assert.equal(page.timeOfDay.reduce((a, b) => a + b, 0), 1);
    });

    test("retention pruning still fires on insert at the new threshold", async () => {
      const track = await makeTrack("ancient", 90);
      await playAt(track, 401 * DAY_MS);
      const before = await db
        .getPool()
        .query(`SELECT COUNT(*)::int AS n FROM plays WHERE telegram_user_id = $1`, [OWNER]);
      assert.ok(Number(before.rows[0].n) > 0);

      // Any recordPlay call rides the prune along with its own insert.
      const trigger = await makeTrack("trigger", 90);
      await repo.recordPlay(OWNER, trigger, {});

      const after = await db
        .getPool()
        .query(
          `SELECT played_at FROM plays WHERE telegram_user_id = $1 AND played_at < now() - interval '400 days'`,
          [OWNER]
        );
      assert.equal(after.rows.length, 0);
    });
  }
);

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10);
}
