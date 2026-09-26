/**
 * Navaar's audio edge.
 *
 * Streaming used to go Telegram -> Render -> phone, and every byte of every
 * play counted against Render's bandwidth allowance, which is what got the
 * service suspended. This Worker takes the middle hop instead: the server
 * still decides who may play what, then answers the player with a redirect to
 * a signed link here, and the audio itself never touches Render.
 *
 *   GET /a/<file_id>?exp=<unix seconds>&type=<mime>&sig=<hex hmac>
 *
 * The signature is HMAC-SHA256 over "<file_id>\n<exp>\n<type>" with
 * STREAM_SIGNING_SECRET, the same secret the server signs with
 * (server/src/stream-links.ts). Anything unsigned, tampered with or expired is
 * refused before Telegram is asked for a byte.
 *
 * Secrets (Settings -> Variables and Secrets):
 *   BOT_TOKEN              the bot's token, to resolve and download files
 *   STREAM_SIGNING_SECRET  shared with the server
 */

/**
 * Telegram promises a file_path stays valid for at least an hour. Remembered
 * per isolate so a seek does not cost a getFile round trip; the Cache API
 * would outlive the isolate, but it is a no-op on workers.dev.
 */
const FILE_PATH_TTL_MS = 50 * 60 * 1000;
const filePaths = new Map();

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Range",
  "Access-Control-Expose-Headers": "Accept-Ranges, Content-Length, Content-Range",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...CORS, "Access-Control-Max-Age": "86400" } });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return text(405, "Method not allowed");
    }
    if (!env.BOT_TOKEN || !env.STREAM_SIGNING_SECRET) {
      return text(500, "Worker is missing BOT_TOKEN or STREAM_SIGNING_SECRET");
    }

    const url = new URL(request.url);
    const match = url.pathname.match(/^\/a\/([^/]+)$/);
    if (!match) return text(404, "Not found");

    const fileId = decodeURIComponent(match[1]);
    const exp = Number(url.searchParams.get("exp"));
    const type = url.searchParams.get("type") ?? "";
    const sig = url.searchParams.get("sig") ?? "";

    const now = Math.floor(Date.now() / 1000);
    if (!Number.isInteger(exp) || exp <= now) return text(403, "Link expired");
    const expected = await sign(env.STREAM_SIGNING_SECRET, `${fileId}\n${exp}\n${type}`);
    if (!timingSafeEqual(sig, expected)) return text(403, "Bad signature");

    const range = request.headers.get("Range");
    let upstream = await download(env.BOT_TOKEN, fileId, range, request.method);
    // A file_path can lapse before our TTL guesses it will; resolve it afresh
    // once rather than failing the play.
    if (upstream && upstream.status === 404) {
      filePaths.delete(fileId);
      upstream = await download(env.BOT_TOKEN, fileId, range, request.method);
    }
    if (!upstream || (upstream.status !== 200 && upstream.status !== 206)) {
      return text(502, "Could not fetch the audio from Telegram");
    }

    const headers = new Headers(CORS);
    headers.set("Content-Type", type || upstream.headers.get("Content-Type") || "application/octet-stream");
    headers.set("Accept-Ranges", "bytes");
    for (const name of ["Content-Length", "Content-Range"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    // A Telegram file never changes under the same file_id, so the phone may
    // keep what it has for as long as the link itself is good. The server
    // hands out the same link for a track all day, so a replay or a seek back
    // is served from the phone's cache instead of the network.
    headers.set("Cache-Control", `private, max-age=${exp - now}, immutable`);

    return new Response(request.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      headers,
    });
  },
};

async function download(token, fileId, range, method) {
  const path = await filePath(token, fileId);
  if (!path) return null;
  return fetch(`https://api.telegram.org/file/bot${token}/${path}`, {
    method,
    headers: range ? { Range: range } : {},
  });
}

async function filePath(token, fileId) {
  const now = Date.now();
  const cached = filePaths.get(fileId);
  if (cached && cached.expiresAt > now) return cached.path;

  const res = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const data = await res.json().catch(() => null);
  const path = data?.ok ? data.result?.file_path : undefined;
  if (!path) return null;

  filePaths.set(fileId, { path, expiresAt: now + FILE_PATH_TTL_MS });
  if (filePaths.size > 1024) {
    for (const [key, value] of filePaths) if (value.expiresAt <= now) filePaths.delete(key);
  }
  return path;
}

async function sign(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function text(status, body) {
  return new Response(body, { status, headers: { ...CORS, "Content-Type": "text/plain; charset=utf-8" } });
}
