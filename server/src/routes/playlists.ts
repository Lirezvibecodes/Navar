import { Router } from "express";
import { requireAuth, AuthedRequest } from "../middleware";
import { asyncHandler } from "../asyncHandler";
import {
  addPlaylistTrack,
  addPlaylistTracksBulk,
  removePlaylistTracksBulk,
  createPlaylist,
  deletePlaylist,
  listPlaylists,
  listPlaylistTracksForListener,
  playlistVisibleToRequester,
  removePlaylistTrack,
  renamePlaylist,
} from "../repo";

/** Reads a `{ trackIds: [...] }` body, rejecting anything that is not a list of strings. */
function readTrackIds(body: unknown): string[] | null {
  const ids = (body as { trackIds?: unknown } | undefined)?.trackIds;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) return null;
  return ids as string[];
}

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

  /**
   * The rows of a playlist.
   *
   * Read-scoped rather than owner-scoped: the same screen serves your own
   * playlist and one a friend has opened up, and a second endpoint for the
   * latter would be two routes that must agree about visibility forever. A
   * playlist the requester cannot see is a 404 — never a 403, which would
   * confirm that the id exists.
   */
  router.get(
    "/:id/tracks",
    requireAuth,
    asyncHandler(async (req, res) => {
      const requesterId = (req as AuthedRequest).telegramUserId;
      const playlist = await playlistVisibleToRequester(req.params.id, requesterId);
      if (!playlist) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json(await listPlaylistTracksForListener(req.params.id, requesterId));
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

  /**
   * Add a whole selection at once. One statement, owner-scoped, so a selection
   * of eighty tracks is one round trip rather than eighty — and ids the caller
   * does not own simply contribute no rows instead of erroring the batch.
   *
   * Declared before /:id/tracks/:trackId so "bulk" is not read as a track id.
   */
  router.post(
    "/:id/tracks/bulk",
    requireAuth,
    asyncHandler(async (req, res) => {
      const trackIds = readTrackIds(req.body);
      if (!trackIds) {
        res.status(400).json({ error: "Missing trackIds" });
        return;
      }
      const added = await addPlaylistTracksBulk(
        req.params.id,
        trackIds,
        (req as AuthedRequest).telegramUserId
      );
      res.json({ added });
    })
  );

  router.delete(
    "/:id/tracks/bulk",
    requireAuth,
    asyncHandler(async (req, res) => {
      const trackIds = readTrackIds(req.body);
      if (!trackIds) {
        res.status(400).json({ error: "Missing trackIds" });
        return;
      }
      const removed = await removePlaylistTracksBulk(
        req.params.id,
        trackIds,
        (req as AuthedRequest).telegramUserId
      );
      res.json({ removed });
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
