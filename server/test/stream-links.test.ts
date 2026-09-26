/**
 * The server signs stream links and the Cloudflare Worker checks them, in two
 * different runtimes with two different crypto APIs. The one thing that must
 * never drift is that they agree: a link the server hands out plays, and a
 * link anyone has edited, or that has run out, does not. Telegram is mocked,
 * so no credentials or network are needed.
 */
import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";

process.env.STREAM_BASE_URL = "https://edge.example/";
process.env.STREAM_SIGNING_SECRET = "test-signing-secret";

const env = { BOT_TOKEN: "test-token", STREAM_SIGNING_SECRET: "test-signing-secret" };
const originalFetch = global.fetch;

async function load() {
  const { edgeStreamUrl } = await import("../src/stream-links");
  // @ts-expect-error -- plain JS module, deployed to Cloudflare as-is.
  const worker = (await import("../../stream-worker/worker.js")).default;
  return { edgeStreamUrl, worker };
}

function mockTelegram() {
  const calls: string[] = [];
  global.fetch = (async (url: string | URL, init?: RequestInit) => {
    const target = String(url);
    calls.push(target);
    if (target.includes("/getFile?")) {
      return new Response(JSON.stringify({ ok: true, result: { file_path: "music/file_1.mp3" } }));
    }
    const range = new Headers(init?.headers).get("Range");
    return range
      ? new Response("abc", { status: 206, headers: { "Content-Range": "bytes 0-2/10", "Content-Length": "3" } })
      : new Response("abcdefghij", { status: 200, headers: { "Content-Length": "10" } });
  }) as typeof fetch;
  return calls;
}

describe("stream links", () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("the same track gets the same link all day, on the configured Worker", async () => {
    const { edgeStreamUrl } = await load();
    const a = edgeStreamUrl("FILE/id+1", "audio/mpeg");
    const b = edgeStreamUrl("FILE/id+1", "audio/mpeg");
    assert.ok(a);
    assert.equal(a, b);
    assert.ok(a.startsWith("https://edge.example/a/FILE%2Fid%2B1?"));
  });

  test("the Worker plays a link the server signed, with seeking", async () => {
    const { edgeStreamUrl, worker } = await load();
    const calls = mockTelegram();
    const link = edgeStreamUrl("FILE/id+1", "audio/mpeg")!;

    const full = await worker.fetch(new Request(link), env);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get("Content-Type"), "audio/mpeg");
    assert.match(full.headers.get("Cache-Control") ?? "", /max-age=\d+/);
    assert.equal(await full.text(), "abcdefghij");

    const part = await worker.fetch(new Request(link, { headers: { Range: "bytes=0-2" } }), env);
    assert.equal(part.status, 206);
    assert.equal(part.headers.get("Content-Range"), "bytes 0-2/10");

    assert.ok(calls.some((c) => c.includes("file_id=FILE%2Fid%2B1")));
  });

  test("an edited or expired link is refused before Telegram is asked", async () => {
    const { edgeStreamUrl, worker } = await load();
    const calls = mockTelegram();
    const link = new URL(edgeStreamUrl("FILE/id+1", "audio/mpeg")!);

    const otherFile = new URL(link);
    otherFile.pathname = "/a/SOMEONE_ELSES_FILE";
    assert.equal((await worker.fetch(new Request(otherFile), env)).status, 403);

    const longer = new URL(link);
    longer.searchParams.set("exp", String(Number(link.searchParams.get("exp")) + 86400));
    assert.equal((await worker.fetch(new Request(longer), env)).status, 403);

    const expired = new URL(link);
    expired.searchParams.set("exp", "1000");
    assert.equal((await worker.fetch(new Request(expired), env)).status, 403);

    assert.equal(calls.length, 0);
  });
});
