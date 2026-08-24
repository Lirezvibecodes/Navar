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
