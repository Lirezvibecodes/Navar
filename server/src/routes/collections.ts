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
  splitArtists,
  listPublicAlbumCopies,
} from "../repo";
import { lookupAlbum, fetchTracklist } from "../musicbrainz-provider";
import type { Track } from "../types";

/**
 * The same rule the album page uses to print an artist under the title, taken
 * down to just the primary name: a MusicBrainz release is credited to its
 * lead artist, so searching "JID feat. Kenny Mason" whole finds nothing where
 * "JID" finds the album. The metadata cache is keyed on this same primary name
 * for the same reason — two owners tagging the same album's artist field with
 * different feature billing should still land on one cached row — and it is
 * also what decides whose copies of an album count as the same album.
 */
function leadArtistOf(tracks: Track[]): string | null {
  const rawArtist = tracks.find((t) => t.artist)?.artist;
  return rawArtist ? splitArtists(rawArtist)[0] ?? null : null;
}

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
   * Copies of this album's tracks that other people have put in a public
   * playlist — what the missing-tracks sheet offers to save into the gaps.
   * Scoped through the caller's own album the same way the metadata route is,
   * both to find the lead artist and so an album they do not have is a 404
   * rather than a search over any name they care to type.
   */
  router.get(
    "/:name/copies",
    requireAuth,
    asyncHandler(async (req, res) => {
      const viewerId = (req as AuthedRequest).telegramUserId;
      const tracks = await listTracksByTag(viewerId, "album", req.params.name);
      if (tracks.length === 0) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      const artist = leadArtistOf(tracks);
      res.json(artist ? await listPublicAlbumCopies(viewerId, req.params.name, artist) : []);
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

      const artist = leadArtistOf(tracks);
      if (!artist) {
        res.json({ releaseDate: null, trackCount: null, tracklist: null });
        return;
      }

      let row = await getAlbumMetadata(artist, req.params.name);
      if (row === null) {
        const found = await lookupAlbum(artist, req.params.name);
        await saveAlbumMetadata(artist, req.params.name, {
          musicbrainzReleaseId: found?.musicbrainzReleaseId ?? null,
          releaseDate: found?.releaseDate ?? null,
          trackCount: found?.trackCount ?? null,
          tracklist: found?.tracklist ?? null,
        }).catch((err: unknown) => {
          console.error("[albums] could not record metadata lookup:", err);
        });
        row = {
          musicbrainz_release_id: found?.musicbrainzReleaseId ?? null,
          release_date: found?.releaseDate ?? null,
          track_count: found?.trackCount ?? null,
          tracklist: found?.tracklist ?? null,
          fetched_at: new Date(),
        };
      } else if (row.musicbrainz_release_id && row.tracklist == null) {
        // A row cached before the tracklist column existed (or one whose
        // detail request failed the first time). One more attempt to top it
        // up — bounded, since it only fires while tracklist is genuinely
        // still missing on an otherwise-matched release.
        const tracklist = await fetchTracklist(row.musicbrainz_release_id);
        if (tracklist) {
          const trackCount = tracklist.length;
          await saveAlbumMetadata(artist, req.params.name, {
            musicbrainzReleaseId: row.musicbrainz_release_id,
            releaseDate: row.release_date,
            trackCount,
            tracklist,
          }).catch((err: unknown) => {
            console.error("[albums] could not record tracklist backfill:", err);
          });
          row = { ...row, tracklist, track_count: trackCount };
        }
      }

      res.setHeader("Cache-Control", "private, max-age=300");
      res.json({
        releaseDate: row.release_date,
        trackCount: row.track_count,
        tracklist: row.tracklist,
      });
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
