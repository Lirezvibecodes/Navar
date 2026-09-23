import { Router } from "express";
import { requireAuth, AuthedRequest } from "../middleware";
import { asyncHandler } from "../asyncHandler";
import {
  listAlbums,
  listArtists,
  listTracksByTag,
  renameAlbum,
  getAlbumMetadata,
  saveAlbumMetadata,
} from "../repo";
import { lookupAlbum } from "../musicbrainz-provider";

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
   * The header's total-track-count and release-date fields, sourced from
   * MusicBrainz and cached in album_metadata. Nothing here is user data — see
   * migration 024 — so the only reason this route requires auth and re-derives
   * the artist from the caller's own tracks is that album identity itself
   * (which tracks carry this album tag) is still scoped to the owner, same as
   * the /:name/tracks route above.
   *
   * This is also the only place a MusicBrainz lookup ever happens. Nothing
   * scans the library and nothing runs in the background: MusicBrainz is asked
   * the first time anybody opens an album nobody has opened before, and never
   * again for that artist+album pair whichever way the answer went.
   */
  router.get(
    "/:name/metadata",
    requireAuth,
    asyncHandler(async (req, res) => {
      const tracks = await listTracksByTag(
        (req as AuthedRequest).telegramUserId,
        "album",
        req.params.name
      );
      if (tracks.length === 0) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      // Same rule the album page itself uses to print an artist under the
      // title: the first track in this album that carries one.
      const artist = tracks.find((t) => t.artist)?.artist ?? null;
      if (!artist) {
        res.json({ releaseDate: null, trackCount: null });
        return;
      }

      let row = await getAlbumMetadata(artist, req.params.name);
      if (row === null) {
        const found = await lookupAlbum(artist, req.params.name);
        await saveAlbumMetadata(artist, req.params.name, {
          musicbrainzReleaseId: found?.musicbrainzReleaseId ?? null,
          releaseDate: found?.releaseDate ?? null,
          trackCount: found?.trackCount ?? null,
        }).catch((err: unknown) => {
          console.error("[albums] could not record metadata lookup:", err);
        });
        row = {
          musicbrainz_release_id: found?.musicbrainzReleaseId ?? null,
          release_date: found?.releaseDate ?? null,
          track_count: found?.trackCount ?? null,
          fetched_at: new Date(),
        };
      }

      res.setHeader("Cache-Control", "private, max-age=300");
      res.json({ releaseDate: row.release_date, trackCount: row.track_count });
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
