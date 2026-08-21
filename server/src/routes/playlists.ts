import { Router } from "express";
import { requireAuth, AuthedRequest } from "../middleware";
import { asyncHandler } from "../asyncHandler";
import {
  addPlaylistTrack,
  createPlaylist,
  deletePlaylist,
  getPlaylist,
  listPlaylists,
  listPlaylistTracks,
  removePlaylistTrack,
  renamePlaylist,
} from "../repo";

export function playlistsRouter(): Router {
  const router = Router();

  router.get(
    "/",
    requireAuth,
    asyncHandler(async (req, res) => {
      const playlists = await listPlaylists((req as AuthedRequest).telegramUserId);
      res.json(playlists);
    })
  );

  router.post(
    "/",
    requireAuth,
    asyncHandler(async (req, res) => {
      const { name } = req.body ?? {};
      if (typeof name !== "string" || name.trim().length === 0) {
        res.status(400).json({ error: "Missing name" });
        return;
      }
      const playlist = await createPlaylist(
        (req as AuthedRequest).telegramUserId,
        name.trim()
      );
      res.status(201).json(playlist);
    })
  );

  router.patch(
    "/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      const { name } = req.body ?? {};
      if (typeof name !== "string" || name.trim().length === 0) {
        res.status(400).json({ error: "Missing name" });
        return;
      }
      const playlist = await renamePlaylist(
        req.params.id,
        (req as AuthedRequest).telegramUserId,
        name.trim()
      );
      if (!playlist) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json(playlist);
    })
  );

  router.delete(
    "/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      const ok = await deletePlaylist(
        req.params.id,
        (req as AuthedRequest).telegramUserId
      );
      if (!ok) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.status(204).end();
    })
  );

  router.get(
    "/:id/tracks",
    requireAuth,
    asyncHandler(async (req, res) => {
      const ownerId = (req as AuthedRequest).telegramUserId;
      const playlist = await getPlaylist(req.params.id, ownerId);
      if (!playlist) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      const tracks = await listPlaylistTracks(req.params.id, ownerId);
      res.json(tracks);
    })
  );

  router.post(
    "/:id/tracks",
    requireAuth,
    asyncHandler(async (req, res) => {
      const { trackId } = req.body ?? {};
      if (typeof trackId !== "string") {
        res.status(400).json({ error: "Missing trackId" });
        return;
      }
      const ok = await addPlaylistTrack(
        req.params.id,
        trackId,
        (req as AuthedRequest).telegramUserId
      );
      if (!ok) {
        res.status(404).json({ error: "Playlist or track not found" });
        return;
      }
      res.status(204).end();
    })
  );

  router.delete(
    "/:id/tracks/:trackId",
    requireAuth,
    asyncHandler(async (req, res) => {
      const ok = await removePlaylistTrack(
        req.params.id,
        req.params.trackId,
        (req as AuthedRequest).telegramUserId
      );
      if (!ok) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.status(204).end();
    })
  );

  return router;
}
