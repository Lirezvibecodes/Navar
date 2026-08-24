/**
 * The authorization seam. getTrackForListener decides who may read a track,
 * and it is the one function in the codebase where a mistake silently hands
 * somebody else's library to a stranger — so all four of the ways a track can
 * become visible are exercised here, along with the case where none of them
 * apply.
 *
 * These run against a real Postgres because the whole point is the SQL. Set
 * TEST_DATABASE_URL to a scratch database; without it the suite skips rather
 * than pretending to have checked anything. It is deliberately not allowed to
 * fall back to DATABASE_URL: the fixtures write and delete rows.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

// A block of ids far outside anything Telegram issues, so the teardown can
// clear the fixtures by range without touching real rows.
const ID_BASE = 900_000_000_000;
const OWNER = ID_BASE + 1;
const FRIEND = ID_BASE + 2;
const STRANGER = ID_BASE + 3;
const GROUP_MATE = ID_BASE + 4;
const PENDING_FRIEND = ID_BASE + 5;
const GROUP_CHAT_ID = -ID_BASE;

type Repo = typeof import("../src/repo");
type Db = typeof import("../src/db");

let repo: Repo;
let db: Db;

const trackIds = {
  unshared: randomUUID(),
  friendsOnly: randomUUID(),
  linkShared: randomUUID(),
  inGroup: randomUUID(),
  deleted: randomUUID(),
};

async function seed(): Promise<void> {
  const pool = db.getPool();

  for (const [id, username] of [
    [OWNER, "owner"],
    [FRIEND, "friend"],
    [STRANGER, "stranger"],
    [GROUP_MATE, "groupmate"],
    [PENDING_FRIEND, "pending"],
  ] as const) {
    await repo.ensureUser(id, username);
  }

  for (const [key, id] of Object.entries(trackIds)) {
    await repo.createTrack({
      id,
      ownerTelegramId: OWNER,
      title: key,
      artist: null,
      album: null,
      durationSeconds: null,
      telegramFileId: `fixture-${key}`,
      mimeType: "audio/mpeg",
      coverImage: null,
      coverMimeType: null,
      originAdderId: OWNER,
    });
  }

  // One playlist per sharing mechanism, each holding exactly one track, so a
  // failure names the mechanism that broke.
  const playlists: Record<string, string> = {};
  for (const [name, visibility, groupChatId, trackId] of [
    ["friends-only", "friends", null, trackIds.friendsOnly],
    ["link-shared", "public", null, trackIds.linkShared],
    ["group crate", "friends", GROUP_CHAT_ID, trackIds.inGroup],
  ] as const) {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO playlists (owner_telegram_id, name, visibility, group_chat_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [OWNER, name, visibility, groupChatId]
    );
    playlists[name] = rows[0].id;
    await pool.query(
      `INSERT INTO playlist_tracks (playlist_id, track_id, position) VALUES ($1, $2, 0)`,
      [rows[0].id, trackId]
    );
  }

  await pool.query(
    `INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1, $2, 'accepted')`,
    [FRIEND, OWNER]
  );
  await pool.query(
    `INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1, $2, 'pending')`,
    [PENDING_FRIEND, OWNER]
  );
  await pool.query(
    `INSERT INTO group_members (group_chat_id, telegram_user_id) VALUES ($1, $2)`,
    [GROUP_CHAT_ID, GROUP_MATE]
  );

  await repo.softDeleteTrack(trackIds.deleted, OWNER);
}

async function teardown(): Promise<void> {
  const pool = db.getPool();
  await pool.query(`DELETE FROM group_members WHERE group_chat_id = $1`, [GROUP_CHAT_ID]);
  // Tracks, playlists and friendships all cascade off users.
  await pool.query(`DELETE FROM users WHERE telegram_user_id >= $1`, [ID_BASE]);
}

describe("getTrackForListener", { skip: TEST_DATABASE_URL ? false : "TEST_DATABASE_URL is not set" }, () => {
  before(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    db = await import("../src/db");
    repo = await import("../src/repo");
    const { runMigrations } = await import("../src/migrate");
    await runMigrations();
    await teardown();
    await seed();
  });

  after(async () => {
    await teardown();
    await db.getPool().end();
  });

  test("the owner can read their own unshared track", async () => {
    const track = await repo.getTrackForListener(trackIds.unshared, OWNER);
    assert.equal(track?.id, trackIds.unshared);
  });

  test("an accepted friend can read a track in a friends-visible playlist", async () => {
    const track = await repo.getTrackForListener(trackIds.friendsOnly, FRIEND);
    assert.equal(track?.id, trackIds.friendsOnly);
  });

  test("anyone can read a track in a link-shared playlist", async () => {
    const track = await repo.getTrackForListener(trackIds.linkShared, STRANGER);
    assert.equal(track?.id, trackIds.linkShared);
  });

  test("a member of the group can read a track in that group's playlist", async () => {
    const track = await repo.getTrackForListener(trackIds.inGroup, GROUP_MATE);
    assert.equal(track?.id, trackIds.inGroup);
  });

  test("a stranger can read none of the tracks that are not link-shared", async () => {
    for (const id of [trackIds.unshared, trackIds.friendsOnly, trackIds.inGroup]) {
      assert.equal(await repo.getTrackForListener(id, STRANGER), null);
    }
  });

  test("a pending friend request grants nothing", async () => {
    assert.equal(await repo.getTrackForListener(trackIds.friendsOnly, PENDING_FRIEND), null);
  });

  test("a friend cannot reach a track that is in no shared playlist", async () => {
    assert.equal(await repo.getTrackForListener(trackIds.unshared, FRIEND), null);
  });

  test("a group member is not thereby a friend", async () => {
    assert.equal(await repo.getTrackForListener(trackIds.friendsOnly, GROUP_MATE), null);
  });

  test("a soft-deleted track is invisible even to its owner", async () => {
    assert.equal(await repo.getTrackForListener(trackIds.deleted, OWNER), null);
    assert.equal(await repo.getTrack(trackIds.deleted, OWNER), null);
  });

  test("visibility does not become ownership: getTrack stays owner-scoped", async () => {
    // The whole reason these are two functions. A friend who can read a track
    // must not be able to reach it through the lookup the mutation routes use.
    assert.equal(await repo.getTrack(trackIds.friendsOnly, FRIEND), null);
    assert.equal(await repo.getTrack(trackIds.linkShared, STRANGER), null);
  });

  test("areFriends is symmetric and ignores pending requests", async () => {
    assert.equal(await repo.areFriends(OWNER, FRIEND), true);
    assert.equal(await repo.areFriends(FRIEND, OWNER), true);
    assert.equal(await repo.areFriends(OWNER, PENDING_FRIEND), false);
    assert.equal(await repo.areFriends(OWNER, STRANGER), false);
  });

  test("restoring brings a track back", async () => {
    const restored = await repo.restoreTrack(trackIds.deleted, OWNER);
    assert.equal(restored?.id, trackIds.deleted);
    assert.equal((await repo.getTrack(trackIds.deleted, OWNER))?.id, trackIds.deleted);
    await repo.softDeleteTrack(trackIds.deleted, OWNER);
  });

  test("a blank tag field clears the column instead of writing an empty string", async () => {
    await repo.updateTrackFields(trackIds.unshared, OWNER, { artist: "Someone" });
    assert.equal((await repo.getTrack(trackIds.unshared, OWNER))?.artist, "Someone");

    // What the edit modal sends when the user empties the field.
    await repo.updateTrackFields(trackIds.unshared, OWNER, { artist: "" });
    assert.equal((await repo.getTrack(trackIds.unshared, OWNER))?.artist, null);

    // An absent key still means "leave it alone".
    await repo.updateTrackFields(trackIds.unshared, OWNER, { title: "Renamed" });
    const track = await repo.getTrack(trackIds.unshared, OWNER);
    assert.equal(track?.title, "Renamed");
    assert.equal(track?.artist, null);
  });
});
