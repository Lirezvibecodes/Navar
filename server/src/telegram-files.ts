import { required } from "./config";

interface TelegramGetFileResponse {
  ok: boolean;
  result?: { file_path?: string };
  description?: string;
}

/**
 * Telegram documents file_path as valid for at least an hour; this stays
 * comfortably inside that so a cached URL is never handed out after it has
 * gone stale.
 */
const URL_TTL_MS = 50 * 60 * 1000;

interface CachedUrl {
  url: string;
  expiresAt: number;
}

/**
 * Seeking an audio element re-requests the stream, and every one of those
 * requests used to cost a getFile round trip to Telegram before a single byte
 * moved. The map is deliberately process-local and unpersisted: a restart
 * simply re-resolves, and the free tier's single instance means there is no
 * second cache to keep coherent.
 */
const urlCache = new Map<string, CachedUrl>();

/** Resolves a Telegram file_id to a time-limited download URL via the Bot API. */
export async function getTelegramFileDownloadUrl(fileId: string): Promise<string> {
  const now = Date.now();

  const cached = urlCache.get(fileId);
  if (cached && cached.expiresAt > now) return cached.url;

  const token = required("BOT_TOKEN");
  const res = await fetch(
    `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`
  );
  const data = (await res.json()) as TelegramGetFileResponse;
  if (!data.ok || !data.result?.file_path) {
    throw new Error(data.description ?? "Telegram getFile failed");
  }

  const url = `https://api.telegram.org/file/bot${token}/${data.result.file_path}`;
  urlCache.set(fileId, { url, expiresAt: now + URL_TTL_MS });

  // The map only ever grows with the tracks actually played, but sweeping the
  // expired entries on write keeps a long-lived instance from holding URLs for
  // tracks nobody has touched in hours.
  if (urlCache.size > 512) {
    for (const [key, value] of urlCache) {
      if (value.expiresAt <= now) urlCache.delete(key);
    }
  }

  return url;
}

interface CachedFile {
  buffer: Buffer;
  contentType: string;
}

/**
 * Bytes, not just the URL. A cover or avatar is small and rarely changes, but
 * without this every cold view — a fresh WebView, a shared playlist opened by
 * someone else, the 60s cover cache lapsing — re-downloads it from Telegram's
 * CDN and re-streams it through this server. Budgeted by size rather than
 * count because images vary from a few KB to a couple MB; least-recently-used
 * eviction is free here since Map iteration order is insertion order and a hit
 * re-inserts.
 *
 * Never used for audio or video: those are large enough to matter and are
 * streamed with Range support, which buffering the whole file would break.
 */
const fileBytesCache = new Map<string, CachedFile>();
let fileBytesCacheSize = 0;
const FILE_BYTES_CACHE_BUDGET = 40 * 1024 * 1024;

/** Resolves a Telegram file_id to its bytes, from cache when possible. */
export async function fetchTelegramFileCached(
  fileId: string,
  fallbackContentType = "image/jpeg"
): Promise<CachedFile | null> {
  const cached = fileBytesCache.get(fileId);
  if (cached) {
    fileBytesCache.delete(fileId);
    fileBytesCache.set(fileId, cached);
    return cached;
  }

  const upstream = await fetch(await getTelegramFileDownloadUrl(fileId));
  if (!upstream.ok || !upstream.body) return null;

  const entry: CachedFile = {
    buffer: Buffer.from(await upstream.arrayBuffer()),
    contentType: upstream.headers.get("content-type") ?? fallbackContentType,
  };
  fileBytesCache.set(fileId, entry);
  fileBytesCacheSize += entry.buffer.length;

  for (const [key, value] of fileBytesCache) {
    if (fileBytesCacheSize <= FILE_BYTES_CACHE_BUDGET) break;
    fileBytesCache.delete(key);
    fileBytesCacheSize -= value.buffer.length;
  }

  return entry;
}
