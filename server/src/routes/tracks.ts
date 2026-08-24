import { Router } from "express";
import { Readable } from "node:stream";
import multer from "multer";
import { requireAuth, AuthedRequest } from "../middleware";
import {
  getPerson,
  getTrack,
  getTrackCover,
  getTrackForListener,
  listTracks,
  restoreTrack,
  restoreTracksBulk,
  saveTrackToLibrary,
  softDeleteTrack,
  softDeleteTracksBulk,
  updateTrackCover,
  getTrackLyrics,
  updateTrackFields,
} from "../repo";
import type { TrackFilter } from "../repo";

/** Reads a `{ trackIds: [...] }` body, rejecting anything that is not a list of strings. */
function readTrackIds(body: unknown): string[] | null {
  const ids = (body as { trackIds?: unknown } | undefined)?.trackIds;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) return null;
  return ids as string[];
}
import { getTelegramFileDownloadUrl } from "../telegram-files";
import { captionOf, personLabel } from "../channels";
import { serveCover, storeCover } from "./covers";
import { asyncHandler } from "../asyncHandler";

/*
 * The cover endpoint serves these bytes back under the mime type they arrived
 * with, so the type is an allowlist rather than a hint: without it an "image"
 * of type text/html or image/svg+xml is a script hosted on the API origin,
 * fetched with a session token in the query string.
 */
const COVER_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

export function tracksRouter(): Router {
  const router = Router();

  router.get(
    "/",
    requireAuth,
    asyncHandler(async (req, res) => {
      // ?filter=unsorted narrows to tracks in no playlist. The unfiltered
      // listing already marks each row with in_playlist, so the Crate's chips
      // do not need this — Home's "Unsorted" shelf does.
      const filter: TrackFilter = req.query.filter === "unsorted" ? "unsorted" : "all";
      const tracks = await listTracks((req as AuthedRequest).telegramUserId, filter);
      res.json(tracks);
    })
  );

  /**
   * Soft-delete a selection. Returns the ids that actually moved so the undo
   * snackbar puts back exactly those, and no more.
   *
   * Declared ahead of the /:id routes so "bulk" is never parsed as a track id.
   */
  router.delete(
    "/bulk",
    requireAuth,
    asyncHandler(async (req, res) => {
      const trackIds = readTrackIds(req.body);
      if (!trackIds) {
        res.status(400).json({ error: "Missing trackIds" });
        return;
      }
      const deleted = await softDeleteTracksBulk(
        trackIds,
        (req as AuthedRequest).telegramUserId
      );
      res.json({ deleted });
    })
  );

  router.post(
    "/bulk/restore",
    requireAuth,
    asyncHandler(async (req, res) => {
      const trackIds = readTrackIds(req.body);
      if (!trackIds) {
        res.status(400).json({ error: "Missing trackIds" });
        return;
      }
      const restored = await restoreTracksBulk(
        trackIds,
        (req as AuthedRequest).telegramUserId
      );
      res.json({ restored });
    })
  );

  router.get(
    "/:id/stream",
    requireAuth,
    asyncHandler(async (req, res) => {
      // A read path: the caller may play anything they can legitimately see,
      // not only what they own. The proxying below is untouched by that — only
      // the lookup that authorises it changed.
      const requesterId = (req as AuthedRequest).telegramUserId;
      const track = await getTrackForListener(req.params.id, requesterId);
      if (!track) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      const downloadUrl = await getTelegramFileDownloadUrl(track.telegram_file_id);
      const range = req.header("range");
      const upstream = await fetch(downloadUrl, range ? { headers: { Range: range } } : undefined);
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

  // Lyrics are a read path, not an ownership one: playing a friend's shared
  // track should show its words. Served separately from the track row so a
  // library listing never carries kilobytes of text per row.
  router.get(
    "/:id/lyrics",
    requireAuth,
    asyncHandler(async (req, res) => {
      const requesterId = (req as AuthedRequest).telegramUserId;
      const track = await getTrackForListener(req.params.id, requesterId);
      if (!track) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json({ lyrics: await getTrackLyrics(track.id) });
    })
  );

  router.get(
    "/:id/cover",
    requireAuth,
    asyncHandler(async (req, res) => {
      const requesterId = (req as AuthedRequest).telegramUserId;
      // The visibility decision happens here; the byte fetch below is scoped by
      // it rather than repeating the predicate itself.
      const track = await getTrackForListener(req.params.id, requesterId);
      if (!track) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      await serveCover(await getTrackCover(track.id), req, res);
    })
  );

  router.patch(
    "/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      const ownerId = (req as AuthedRequest).telegramUserId;
      const body = (req.body ?? {}) as Record<string, unknown>;

      // Only the keys the client actually sent are forwarded: to updateTrackFields
      // an absent key means "leave it" and a present blank one means "clear it".
      const fields: Parameters<typeof updateTrackFields>[2] = {};
      for (const key of ["title", "artist", "album", "lyrics"] as const) {
        if (key in body) {
          const value = body[key];
          fields[key] = typeof value === "string" ? value : null;
        }
      }
      // The heart. A boolean rather than a timestamp: when a track became a
      // favourite is the server's to decide, not the client's.
      if ("favorited" in body) fields.favorited = body.favorited === true;

      const track = await updateTrackFields(req.params.id, ownerId, fields);
      if (!track) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      res.json(track);
    })
  );

  router.post(
    "/:id/cover",
    requireAuth,
    upload.single("cover"),
    asyncHandler(async (req, res) => {
      const ownerId = (req as AuthedRequest).telegramUserId;
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "Missing cover file" });
        return;
      }

      if (!COVER_TYPES.has(file.mimetype)) {
        res.status(400).json({ error: "Cover must be a JPEG, PNG, WebP or GIF" });
        return;
      }

      // Read the track first: it names the picture in the channel, and it
      // keeps an upload for somebody else's track from being posted there
      // before the ownership check gets a chance to refuse it.
      const track = await getTrack(req.params.id, ownerId);
      if (!track) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      const owner = await getPerson(ownerId);
      const updated = await updateTrackCover(
        req.params.id,
        ownerId,
        await storeCover(
          file.buffer,
          file.mimetype,
          captionOf([
            [track.title, track.artist].filter(Boolean).join(" — ") || "Untitled",
            track.album ? `Album: ${track.album}` : null,
            `Cover set by ${personLabel(ownerId, owner?.username)}`,
            track.id,
          ])
        )
      );
      if (!updated) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      res.json(updated);
    })
  );

  // Soft delete: the row survives for the undo window so the snackbar has
  // something to put back, and so playlists holding it do not break.
  router.delete(
    "/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      const ownerId = (req as AuthedRequest).telegramUserId;
      const deleted = await softDeleteTrack(req.params.id, ownerId);
      if (!deleted) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.status(204).end();
    })
  );

  /**
   * Keep somebody else's track.
   *
   * The visibility check is here so the refusal can be a 404 that says nothing
   * about whether the id exists, and the copy itself repeats the same check in
   * SQL. Saving your own track is refused rather than silently duplicating the
   * row: two identical entries in one library is not what anybody meant by it.
   */
  router.post(
    "/:id/save",
    requireAuth,
    asyncHandler(async (req, res) => {
      const saverId = (req as AuthedRequest).telegramUserId;
      const source = await getTrackForListener(req.params.id, saverId);
      if (!source) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      if (Number(source.owner_telegram_id) === saverId) {
        res.status(400).json({ error: "This one is already yours" });
        return;
      }

      const saved = await saveTrackToLibrary(req.params.id, saverId);
      if (!saved) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.status(saved.already ? 200 : 201).json(saved.track);
    })
  );

  router.post(
    "/:id/restore",
    requireAuth,
    asyncHandler(async (req, res) => {
      const ownerId = (req as AuthedRequest).telegramUserId;
      const track = await restoreTrack(req.params.id, ownerId);
      if (!track) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json(track);
    })
  );

  return router;
}
