import { Router } from "express";
import { Readable } from "node:stream";
import { requireAuth, AuthedRequest } from "../middleware";
import { asyncHandler } from "../asyncHandler";
import { getUserAvatarFileId, listPlaylistsVisibleTo } from "../repo";
import { getTelegramFileDownloadUrl } from "../telegram-files";

export function usersRouter(): Router {
  const router = Router();

  /**
   * Proxy a user's Telegram profile photo.
   *
   * The photo is not stored — only the file_id is, captured on /start — so this
   * resolves through the same cached getFile path the audio stream uses and
   * pipes the bytes back. The route is behind auth because it is an in-app
   * asset, but it is deliberately not scoped to a relationship: avatars appear
   * beside people you have not met yet, in search results and suggestions. A
   * name is the thing that stays private, not a picture Telegram already shows
   * to anyone who can find the account.
   *
   * A user with no photo is the ordinary case and gets a clean 404: plenty of
   * people hide theirs, and the client is expected to draw its initial-and-tint
   * fallback rather than treat the miss as a failure.
   */
  router.get(
    "/:id/avatar",
    requireAuth,
    asyncHandler(async (req, res) => {
      const userId = Number(req.params.id);
      if (!Number.isSafeInteger(userId)) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      const fileId = await getUserAvatarFileId(userId);
      if (!fileId) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      const upstream = await fetch(await getTelegramFileDownloadUrl(fileId));
      if (!upstream.ok || !upstream.body) {
        res.status(502).json({ error: "Failed to fetch avatar from Telegram" });
        return;
      }

      res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "image/jpeg");
      // Avatars change rarely and the file_id only moves when the user changes
      // their photo, so letting the WebView keep it for a day removes a request
      // from every list that shows faces.
      res.setHeader("Cache-Control", "private, max-age=86400");
      Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream).pipe(res);
    })
  );

  /**
   * What this person has opened up to the requester.
   *
   * An empty array is the honest answer both for someone who shares nothing
   * and for someone the requester is not connected to: a "hidden" placeholder
   * would tell a stranger how much there is to be curious about.
   */
  router.get(
    "/:id/playlists",
    requireAuth,
    asyncHandler(async (req, res) => {
      const ownerId = Number(req.params.id);
      if (!Number.isSafeInteger(ownerId) || ownerId <= 0) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json(
        await listPlaylistsVisibleTo(ownerId, (req as AuthedRequest).telegramUserId)
      );
    })
  );

  return router;
}
