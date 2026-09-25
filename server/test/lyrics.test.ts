/**
 * The lyrics lookup's two decisions: whether a track is due a lookup, and
 * whether LRCLIB's reply was an answer (recorded) or a failure (not recorded,
 * so the next play asks again). LRCLIB itself is replaced by a stub `fetch`;
 * nothing here touches the network or a database.
 */
import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { LYRICS_RETRY_MS, lookupLyrics, lyricsLookupDue } from "../src/lyrics-provider";

const query = { title: "WIND", artist: "Dorcei", album: null, durationSeconds: 200 };
const realFetch = globalThis.fetch;

/** Answer /get and /search from LRCLIB with whatever each is given. */
function stubLrclib(replies: { get: () => Response; search: () => Response }): void {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    return url.includes("/search?") ? replies.search() : replies.get();
  }) as typeof fetch;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("lookupLyrics", () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("words from the exact match are an answer", async () => {
    stubLrclib({ get: () => json({ plainLyrics: "la la" }), search: () => json([]) });
    assert.deepEqual(await lookupLyrics(query), { answered: true, lyrics: "la la" });
  });

  test("a 404 and an empty search are an answer: no words", async () => {
    stubLrclib({ get: () => json({}, 404), search: () => json([]) });
    assert.deepEqual(await lookupLyrics(query), { answered: true, lyrics: null });
  });

  test("an instrumental is an answer: no words", async () => {
    stubLrclib({ get: () => json({ instrumental: true }), search: () => json([]) });
    assert.deepEqual(await lookupLyrics(query), { answered: true, lyrics: null });
  });

  test("a network error with nothing found is not an answer", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    assert.deepEqual(await lookupLyrics(query), { answered: false });
  });

  test("a 5xx or a rate limit with nothing found is not an answer", async () => {
    stubLrclib({ get: () => json({}, 503), search: () => json([], 429) });
    assert.deepEqual(await lookupLyrics(query), { answered: false });
  });

  test("words from search still count when the exact match failed", async () => {
    stubLrclib({ get: () => json({}, 500), search: () => json([{ syncedLyrics: "[00:01.00] hi" }]) });
    assert.deepEqual(await lookupLyrics(query), { answered: true, lyrics: "[00:01.00] hi" });
  });

  test("a track with no title is a miss, and LRCLIB is not asked", async () => {
    let asked = false;
    globalThis.fetch = (async () => {
      asked = true;
      return json({});
    }) as typeof fetch;
    assert.deepEqual(await lookupLyrics({ ...query, title: "  " }), { answered: true, lyrics: null });
    assert.equal(asked, false);
  });
});

describe("lyricsLookupDue", () => {
  const now = Date.parse("2026-09-25T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms);
  const row = (over: Partial<Parameters<typeof lyricsLookupDue>[0]>) => ({
    lyrics: null,
    lyrics_checked_at: null,
    lyrics_owner_edited: false,
    ...over,
  });

  test("a track never looked up is due", () => {
    assert.equal(lyricsLookupDue(row({}), now), true);
  });

  test("a track with words is never due", () => {
    assert.equal(lyricsLookupDue(row({ lyrics: "la", lyrics_checked_at: ago(LYRICS_RETRY_MS * 10) }), now), false);
  });

  test("a miss is not due again within a day", () => {
    assert.equal(lyricsLookupDue(row({ lyrics_checked_at: ago(LYRICS_RETRY_MS - 60_000) }), now), false);
  });

  test("a miss is due again after a day", () => {
    assert.equal(lyricsLookupDue(row({ lyrics_checked_at: ago(LYRICS_RETRY_MS) }), now), true);
  });

  test("words the owner cleared by hand are never looked up again", () => {
    assert.equal(
      lyricsLookupDue(row({ lyrics_owner_edited: true, lyrics_checked_at: ago(LYRICS_RETRY_MS * 10) }), now),
      false
    );
    assert.equal(lyricsLookupDue(row({ lyrics_owner_edited: true }), now), false);
  });
});
