import { Router } from "express";
import multer from "multer";
import { requireAuth, AuthedRequest } from "../middleware";
import { asyncHandler } from "../asyncHandler";
import {
  addPlaylistTrack,
  addPlaylistTracksBulk,
  removePlaylistTracksBulk,
  createPlaylist,
  deletePlaylist,
  getPlaylistCover,
  listPlaylists,
  listPlaylistTracksForListener,
  playlistVisibleToRequester,
  removePlaylistTrack,
  updatePlaylist,
  updatePlaylistCover,
  setPlaylistCover,
} from "../repo";
import { serveCover, storeCover } from "./covers";

/** The cap the database enforces too — see migration 008. */
const DESCRIPTION_MAX = 500;

/**
 * The same allowlist and the same ceiling the track cover upload uses. A
 * playlist's picture and a track's picture take the same path out to the cover
 * channel, so they must not disagree about what is allowed down it.
 */
const COVER_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

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

  /**
   * A partial update: send the name, the description, or both.
   *
   * An absent key leaves the field alone; a null or empty description clears
   * it. The name still cannot be blanked, because a playlist with no name is
   * unreachable in every list that draws it.
   */
  router.patch(
    "/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      const body = (req.body ?? {}) as {
        name?: unknown;
        description?: unknown;
      };
      const fields: { name?: string; description?: string | null } = {};

      if (body.name !== undefined) {
        if (typeof body.name !== "string" || body.name.trim().length === 0) {
          res.status(400).json({ error: "Missing name" });
          return;
        }
        fields.name = body.name.trim();
      }

      if (body.description !== undefined) {
        if (body.description === null) {
          fields.description = null;
        } else if (typeof body.description !== "string") {
          res.status(400).json({ error: "Description must be text" });
          return;
        } else {
          const text = body.description.trim();
          if (text.length > DESCRIPTION_MAX) {
            res
              .status(400)
              .json({ error: `Description must be ${DESCRIPTION_MAX} characters or fewer` });
            return;
          }
          // Empty is the same as never having written one, and storing "" would
          // make every reader test for two kinds of nothing.
          fields.description = text.length === 0 ? null : text;
        }
      }

      const playlist = await updatePlaylist(
        req.params.id,
        (req as AuthedRequest).telegramUserId,
        fields
      );
      if (!playlist) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json(playlist);
    })
  );

  /**
   * Pin one of the playlist's own tracks as its cover, or send null to hand
   * the choice back to the playlist.
   *
   * Its own route rather than a field on PATCH /:id: the cover is a reference
   * to another row that has to be checked against the playlist's own tracks,
   * which is a different kind of write from editing two text fields.
   */
  router.put(
    "/:id/cover",
    requireAuth,
    asyncHandler(async (req, res) => {
      const { trackId } = req.body ?? {};
      if (trackId != null && typeof trackId !== "string") {
        res.status(400).json({ error: "Bad trackId" });
        return;
      }
      const playlist = await setPlaylistCover(
        req.params.id,
        (req as AuthedRequest).telegramUserId,
        trackId ?? null
      );
      // One 404 for both "no such playlist" and "that track is not in it with
      // artwork", so the response never confirms an id the caller guessed.
      if (!playlist) {
        res.status(404).json({ error: "Playlist or track not found" });
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

  /**
   * A playlist's own picture.
   *
   * A read path, scoped by whether the requester may see the playlist at all
   * rather than by ownership: a shared playlist showing a blank square to the
   * person it was shared with would be a strange thing to have shared.
   */
  router.get(
    "/:id/artwork",
    requireAuth,
    asyncHandler(async (req, res) => {
      const visible = await playlistVisibleToRequester(
        req.params.id,
        (req as AuthedRequest).telegramUserId
      );
      if (!visible) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      await serveCover(await getPlaylistCover(req.params.id), req, res);
    })
  );

  router.post(
    "/:id/artwork",
    requireAuth,
    upload.single("cover"),
    asyncHandler(async (req, res) => {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "Missing cover file" });
        return;
      }
      if (!COVER_TYPES.has(file.mimetype)) {
        res.status(400).json({ error: "Cover must be a JPEG, PNG, WebP or GIF" });
        return;
      }

      const stored = await storeCover(file.buffer, file.mimetype);
      // A playlist cover is only ever a channel photo. There is no bytes column
      // on playlists to fall back into, so a channel that would not take the
      // picture is an honest failure rather than a silently dropped upload.
      if (stored.kind !== "telegram") {
        res.status(503).json({ error: "Could not store the cover right now" });
        return;
      }

      const updated = await updatePlaylistCover(
        req.params.id,
        (req as AuthedRequest).telegramUserId,
        stored.fileId
      );
      if (!updated) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json(updated);
    })
  );

  /** Clears the picture, so the playlist goes back to choosing one for itself. */
  router.delete(
    "/:id/artwork",
    requireAuth,
    asyncHandler(async (req, res) => {
      const updated = await updatePlaylistCover(
        req.params.id,
        (req as AuthedRequest).telegramUserId,
        null
      );
      if (!updated) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json(updated);
    })
  );

  return router;
}
