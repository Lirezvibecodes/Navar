/**
 * The image byte cache added to speed up cover/avatar loading. The one thing
 * worth a runnable check is the part with a branch: a hit must skip the
 * network, and the budget eviction must actually free space rather than grow
 * unbounded. Both run against a mocked fetch, so no Telegram credentials or
 * network access are needed.
 */
import { afterEach, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";

process.env.BOT_TOKEN = "test-token";

let fetchCalls = 0;
const originalFetch = global.fetch;

function mockFetch(bytesPerFile: number) {
  fetchCalls = 0;
  global.fetch = (async (url: string | URL) => {
    fetchCalls++;
    const target = String(url);
    // The download URL is built from file_path, so it must not itself contain
    // "getFile" or it would be mistaken for a second getFile call below.
    if (target.includes("/getFile?")) {
      const fileId = new URL(target).searchParams.get("file_id");
      return new Response(
        JSON.stringify({ ok: true, result: { file_path: `path-for-${fileId}` } }),
        { status: 200 }
      );
    }
    return new Response(new Uint8Array(bytesPerFile), {
      status: 200,
      headers: { "content-type": "image/jpeg" },
    });
  }) as typeof fetch;
}

describe("fetchTelegramFileCached", () => {
  beforeEach(() => mockFetch(1024));
  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("a second request for the same file is served from cache, not fetched again", async () => {
    const { fetchTelegramFileCached } = await import("../src/telegram-files");
    const first = await fetchTelegramFileCached("file-a");
    const callsAfterFirst = fetchCalls;
    const second = await fetchTelegramFileCached("file-a");

    assert.ok(first);
    assert.equal(second?.buffer.length, first?.buffer.length);
    assert.equal(fetchCalls, callsAfterFirst, "cache hit must not call fetch again");
  });

  test("the budget evicts the least-recently-used entry once exceeded", async () => {
    // Each entry is ~15MB; the budget is 40MB, so a 4th distinct file must
    // push out the oldest untouched one rather than growing past the budget.
    mockFetch(15 * 1024 * 1024);
    const { fetchTelegramFileCached } = await import("../src/telegram-files");

    await fetchTelegramFileCached("evict-1");
    await fetchTelegramFileCached("evict-2");
    await fetchTelegramFileCached("evict-3");
    const callsBeforeRefetch = fetchCalls;

    // evict-1 should have been dropped; asking for it again must hit the network.
    await fetchTelegramFileCached("evict-1");
    assert.equal(fetchCalls, callsBeforeRefetch + 1, "evicted entry should re-fetch");
  });
});
