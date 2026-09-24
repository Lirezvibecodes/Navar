/**
 * The best-tag auto-equip: until somebody picks their own tags, their profile
 * wears the single highest-tier tag they have unlocked, and the moment they
 * do pick, the auto-equip never touches their set again.
 *
 * Runs against a real Postgres, like visibility.test.ts, and skips without
 * TEST_DATABASE_URL. Its fixture ids are a block of their own so its
 * teardown cannot touch another suite's rows.
 */
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const ID_BASE = 900_000_000_300;
const ID_END = ID_BASE + 100;
const USER = ID_BASE + 1;
const FRIENDS = Array.from({ length: 10 }, (_, i) => ID_BASE + 10 + i);

type Repo = typeof import("../src/repo");
type Db = typeof import("../src/db");
type Evaluator = typeof import("../src/tagEvaluator");

let repo: Repo;
let db: Db;
let evaluator: Evaluator;

async function teardown(): Promise<void> {
  await db
    .getPool()
    .query(`DELETE FROM users WHERE telegram_user_id >= $1 AND telegram_user_id < $2`, [
      ID_BASE,
      ID_END,
    ]);
}

async function befriend(friends: number[]): Promise<void> {
  for (const friend of friends) {
    await db
      .getPool()
      .query(
        `INSERT INTO friendships (requester_id, addressee_id, status) VALUES ($1, $2, 'accepted')`,
        [friend, USER]
      );
  }
  await evaluator.evaluateSocialTags(USER);
}

async function equipped(): Promise<string[]> {
  const { rows } = await db
    .getPool()
    .query<{ tag_id: string }>(
      `SELECT tag_id FROM user_equipped_tags WHERE telegram_user_id = $1 ORDER BY position`,
      [USER]
    );
  return rows.map((r) => r.tag_id);
}

describe("best-tag auto-equip", { skip: TEST_DATABASE_URL ? false : "TEST_DATABASE_URL is not set" }, () => {
  before(async () => {
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    db = await import("../src/db");
    repo = await import("../src/repo");
    evaluator = await import("../src/tagEvaluator");
    const { runMigrations } = await import("../src/migrate");
    await runMigrations();
    await teardown();
    // Plain inserts rather than ensureUser, whose fire-and-forget Newcomer
    // grant would race the assertions; the grant is awaited here instead.
    await db
      .getPool()
      .query(`INSERT INTO users (telegram_user_id) SELECT unnest($1::bigint[])`, [
        [USER, ...FRIENDS],
      ]);
    await evaluator.grantNewcomerTag(USER);
  });

  after(async () => {
    await teardown();
    await db.getPool().end();
  });

  test("a brand-new user wears Newcomer", async () => {
    assert.deepEqual(await equipped(), ["newcomer"]);
  });

  test("an untouched set swaps to the highest tier unlocked, alone", async () => {
    // Five friends unlock First Contact (copper) and Social Butterfly (chrome).
    await befriend(FRIENDS.slice(0, 5));
    assert.deepEqual(await equipped(), ["social_butterfly"]);
  });

  test("once the user picks, a better unlock leaves their choice alone", async () => {
    assert.equal(await repo.setEquippedTags(USER, ["newcomer"]), "ok");
    // Ten friends unlock Connector (gold).
    await befriend(FRIENDS.slice(5));
    const states = await repo.getTagStates(USER);
    assert.equal(states.find((t) => t.id === "connector")?.unlocked, true);
    assert.deepEqual(await equipped(), ["newcomer"]);
  });
});
