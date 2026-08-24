import { Router } from "express";
import { Readable } from "node:stream";
import type { Request, Response, NextFunction } from "express";
import {
  getSharedPlaylist,
  getSharedPlaylistCover,
  getSharedTrack,
  getSharedTrackCover,
  listSharedPlaylistTracks,
} from "../repo";
import { getTelegramFileDownloadUrl } from "../telegram-files";
import { miniAppLink } from "../bot-identity";
import { serveCover } from "./covers";
import { asyncHandler } from "../asyncHandler";
import type { SharedPlaylistPage } from "../types";

/**
 * The one part of Navaar that answers to nobody.
 *
 * Every other route in this app knows who is calling. These do not: the slug
 * in the URL is the entire credential, which is why the label in the app says
 * "Anyone with the link" rather than "Public" — that is literally what it
 * grants, forever, to whoever the link reaches.
 *
 * Two rules hold the whole surface together, and neither may be relaxed:
 *
 *   1. Every query is scoped by the slug *and* by visibility = 'public'. A
 *      friends-only playlist has a slug too — the same address, opened inside
 *      Telegram where the friendship is checked — so a lookup by slug alone
 *      would publish every one of them.
 *   2. No route here ever accepts a bare track id. The track has to be proved
 *      to sit in that slug's playlist inside the same statement that fetches
 *      it, or these become an open proxy over the whole library for anyone
 *      holding one link.
 *
 * What comes back is metadata and media, never people. No owner id, no
 * origin, no credits, no telegram_file_id — see SharedTrack.
 */

/** A minute, and what one address may spend inside it. */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 120;

/**
 * Enough headroom for a person listening — a playlist's covers plus the range
 * requests a seek makes are a few dozen — and a hard ceiling on a script
 * walking the same link. Free-tier bandwidth is the thing actually being
 * protected, and this is the crude form of that: a counter in memory, keyed by
 * address, which is all this scale warrants and all a sleeping instance can
 * hold anyway.
 *
 * Expiry is lazy on purpose. There are no timers here — a Render instance
 * asleep at 3am runs nothing — so a bucket is only ever examined when its
 * address comes back, and the map is swept when it grows rather than on a
 * schedule.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();
const SWEEP_AT = 5_000;

function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const now = Date.now();

  if (buckets.size > SWEEP_AT) {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  const key = req.ip ?? "unknown";
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    next();
    return;
  }

  if (bucket.count >= MAX_PER_WINDOW) {
    res.setHeader("Retry-After", Math.ceil((bucket.resetAt - now) / 1000));
    res.status(429).json({ error: "Too many requests" });
    return;
  }

  bucket.count += 1;
  next();
}

export function sharedRouter(): Router {
  const router = Router();

  router.use(rateLimit);

  router.get(
    "/:slug",
    asyncHandler(async (req, res) => {
      const playlist = await getSharedPlaylist(req.params.slug);
      if (!playlist) {
        res.status(404).json({ error: "This link is not live" });
        return;
      }
      // The one outbound thing this surface offers. The share page is the only
      // screen of Navaar that runs outside Telegram, so it has to carry its own
      // way back in; composed here rather than stored because it depends on the
      // bot username resolved at startup.
      res.json({ ...playlist, app_link: miniAppLink() } satisfies SharedPlaylistPage);
    })
  );

  router.get(
    "/:slug/tracks",
    asyncHandler(async (req, res) => {
      // No 404 for an empty playlist that exists: the page has already drawn
      // its header from the call above, and a shared crate somebody emptied is
      // an empty crate rather than a broken link.
      const playlist = await getSharedPlaylist(req.params.slug);
      if (!playlist) {
        res.status(404).json({ error: "This link is not live" });
        return;
      }
      res.json(await listSharedPlaylistTracks(req.params.slug));
    })
  );

  /** The playlist's own picture. */
  router.get(
    "/:slug/cover",
    asyncHandler(async (req, res) => {
      await serveCover(await getSharedPlaylistCover(req.params.slug), req, res);
    })
  );

  router.get(
    "/:slug/tracks/:trackId/cover",
    asyncHandler(async (req, res) => {
      await serveCover(
        await getSharedTrackCover(req.params.slug, req.params.trackId),
        req,
        res
      );
    })
  );

  /**
   * The audio, proxied exactly as the authenticated route proxies it — same
   * range passthrough, same 206 — because a shared page that cannot seek is a
   * shared page nobody listens to twice. The only difference is the lookup,
   * and the lookup is the entire authorization.
   */
  router.get(
    "/:slug/tracks/:trackId/stream",
    asyncHandler(async (req, res) => {
      const track = await getSharedTrack(req.params.slug, req.params.trackId);
      if (!track) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      const downloadUrl = await getTelegramFileDownloadUrl(track.telegram_file_id);
      const range = req.header("range");
      const upstream = await fetch(
        downloadUrl,
        range ? { headers: { Range: range } } : undefined
      );
      if (!upstream.ok) {
        res.status(502).json({ error: "Failed to fetch audio from Telegram" });
        return;
      }

      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Type", track.mime_type ?? "application/octet-stream");
      const contentLength = upstream.headers.get("content-length");
      if (contentLength) res.setHeader("Content-Length", contentLength);
      const contentRange = upstream.headers.get("content-range");
      if (range && contentRange) {
        res.status(206);
        res.setHeader("Content-Range", contentRange);
      }

      if (!upstream.body) {
        res.end();
        return;
      }
      Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream).pipe(res);
    })
  );

  return router;
}
