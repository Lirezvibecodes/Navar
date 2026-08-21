import { Router } from "express";
import { Readable } from "node:stream";
import multer from "multer";
import { requireAuth, AuthedRequest } from "../middleware";
import { getTrack, getTrackCover, listTracks, updateTrackCover, updateTrackTags } from "../repo";
import { getTelegramFileDownloadUrl } from "../telegram-files";
import { asyncHandler } from "../asyncHandler";

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
      const tracks = await listTracks((req as AuthedRequest).telegramUserId);
      res.json(tracks);
    })
  );

  router.get(
    "/:id/stream",
    requireAuth,
    asyncHandler(async (req, res) => {
      const ownerId = (req as AuthedRequest).telegramUserId;
      const track = await getTrack(req.params.id, ownerId);
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

  router.get(
    "/:id/cover",
    requireAuth,
    asyncHandler(async (req, res) => {
      const ownerId = (req as AuthedRequest).telegramUserId;
      const cover = await getTrackCover(req.params.id, ownerId);
      if (!cover) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      res.setHeader("Content-Type", cover.coverMimeType ?? "image/jpeg");
      res.send(cover.coverImage);
    })
  );

  router.patch(
    "/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      const ownerId = (req as AuthedRequest).telegramUserId;
      const { title, artist, album } = req.body ?? {};

      const track = await updateTrackTags(req.params.id, ownerId, {
        title,
        artist,
        album,
      });
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

      const updated = await updateTrackCover(req.params.id, ownerId, file.buffer, file.mimetype);
      if (!updated) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      res.json(updated);
    })
  );

  return router;
}
