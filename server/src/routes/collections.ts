import { Router } from "express";
import { requireAuth, AuthedRequest } from "../middleware";
import { asyncHandler } from "../asyncHandler";
import { listAlbums, listArtists, listTracksByTag, renameAlbum } from "../repo";

/**
 * Albums and artists have no tables. Both views are a GROUP BY over the tags on
 * the caller's own tracks, so the only thing these routes own is the shape of
 * the response — the grouping, and the decision to skip untagged tracks rather
 * than invent an "Unknown" bucket for them, live in the repository.
 */
export function albumsRouter(): Router {
  const router = Router();

  router.get(
    "/",
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(await listAlbums((req as AuthedRequest).telegramUserId));
    })
  );

  router.get(
    "/:name/tracks",
    requireAuth,
    asyncHandler(async (req, res) => {
      const tracks = await listTracksByTag(
        (req as AuthedRequest).telegramUserId,
        "album",
        req.params.name
      );
      // An album that matches nothing does not exist, which is the same answer
      // as an album belonging to somebody else.
      if (tracks.length === 0) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json(tracks);
    })
  );

  /**
   * Renaming an album rewrites the tag on every track carrying it. There is no
   * album row, so this is the whole operation.
   */
  router.patch(
    "/:name",
    requireAuth,
    asyncHandler(async (req, res) => {
      const { name } = (req.body ?? {}) as Record<string, unknown>;
      if (typeof name !== "string" || name.trim().length === 0) {
        res.status(400).json({ error: "Missing name" });
        return;
      }

      const updated = await renameAlbum(
        (req as AuthedRequest).telegramUserId,
        req.params.name,
        name.trim()
      );
      if (updated === 0) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json({ name: name.trim(), track_count: updated });
    })
  );

  return router;
}

export function artistsRouter(): Router {
  const router = Router();

  router.get(
    "/",
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(await listArtists((req as AuthedRequest).telegramUserId));
    })
  );

  router.get(
    "/:name/tracks",
    requireAuth,
    asyncHandler(async (req, res) => {
      const tracks = await listTracksByTag(
        (req as AuthedRequest).telegramUserId,
        "artist",
        req.params.name
      );
      if (tracks.length === 0) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json(tracks);
    })
  );

  return router;
}
