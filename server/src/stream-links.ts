import { createHmac } from "node:crypto";
import { config } from "./config";

const DAY_SECONDS = 24 * 60 * 60;

/**
 * A signed link to the audio on the stream Worker (stream-worker/worker.js),
 * or null when the Worker is not configured and the caller should proxy the
 * audio itself.
 *
 * Callers must have already decided the requester may play the track: the
 * link is the authorization, and anyone holding it can play that one file
 * until it expires.
 *
 * The expiry is snapped to the end of tomorrow (UTC) rather than "now plus a
 * day", so every request for a track on the same day gets byte-for-byte the
 * same URL. That is what lets the phone's cache, keyed on the URL, serve a
 * replay or a seek without going back to the network.
 */
export function edgeStreamUrl(fileId: string, mimeType: string | null): string | null {
  const { streamBaseUrl, streamSigningSecret } = config;
  if (!streamBaseUrl || !streamSigningSecret) return null;

  const now = Math.floor(Date.now() / 1000);
  const exp = (Math.floor(now / DAY_SECONDS) + 2) * DAY_SECONDS;
  const type = mimeType ?? "application/octet-stream";
  const sig = createHmac("sha256", streamSigningSecret)
    .update(`${fileId}\n${exp}\n${type}`)
    .digest("hex");

  const params = new URLSearchParams({ exp: String(exp), type, sig });
  return `${streamBaseUrl}/a/${encodeURIComponent(fileId)}?${params}`;
}
