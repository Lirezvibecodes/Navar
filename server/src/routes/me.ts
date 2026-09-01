import { Router } from "express";
import multer from "multer";
import { requireAuth, AuthedRequest } from "../middleware";
import { asyncHandler } from "../asyncHandler";
import {
  ACCENT_PRESETS,
  getListeningStats,
  getPerson,
  getTrackForListener,
  recordPlay,
  setAccentColor,
  setCustomAvatar,
  setHandle,
  setListeningPrivacy,
  setListeningStatus,
} from "../repo";
import { captionOf, personLabel, postCoverVideo } from "../channels";
import { storeCover } from "./covers";
import { getTelegramFileDownloadUrl } from "../telegram-files";
import { renderStoryVideo } from "../ffmpeg";
import { HANDLE_RULE, normaliseHandle } from "../handles";

/** Same allowlist the playlist and track cover uploads use. */
const COVER_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const storyVideoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 3 * 1024 * 1024, files: 20 },
});

/**
 * The caller's own account.
 *
 * Separate from /api/users, which is about looking at other people. Everything
 * here is implicitly scoped to whoever holds the session, so no route in this
 * file takes a user id — there is nothing to get wrong.
 */
export function meRouter(): Router {
  const router = Router();

  /**
   * Choose or change the name this person is known by in Navaar.
   *
   * A change is allowed rather than a one-time claim. The alternative — a
   * handle fixed forever at first launch — punishes a typo made in the ten
   * seconds before anybody has seen the app, and there is nothing here that
   * a handle is the durable key of: friendships, tracks and playlists are all
   * keyed on the Telegram id underneath.
   */
  router.post(
    "/handle",
    requireAuth,
    asyncHandler(async (req, res) => {
      const handle = normaliseHandle((req.body ?? {}).handle);
      if (!handle) {
        res.status(400).json({ error: HANDLE_RULE });
        return;
      }

      const outcome = await setHandle((req as AuthedRequest).telegramUserId, handle);
      if (outcome === "taken") {
        // 409 rather than 400: the name is well-formed, it is just spoken for,
        // and the client says something quite different about each.
        res.status(409).json({ error: `@${handle} is taken` });
        return;
      }
      res.json({ handle });
    })
  );

  /**
   * What this person is playing, or nothing.
   *
   * PATCH rather than POST because there is one status per person and this
   * replaces it. `{ trackId: null }` clears it, which is what the player sends
   * when it has nothing loaded — but it is not what makes a status expire:
   * expiry is the ten-minute window in the feed query, because a WebView that
   * is swiped away never gets to send anything at all.
   *
   * A track the caller cannot see is not a track, and gets the 404 that says
   * so rather than a 403 that would confirm it exists.
   */
  router.patch(
    "/listening-status",
    requireAuth,
    asyncHandler(async (req, res) => {
      const { trackId } = req.body ?? {};
      if (trackId != null && typeof trackId !== "string") {
        res.status(400).json({ error: "trackId must be a track or null" });
        return;
      }

      const ok = await setListeningStatus(
        (req as AuthedRequest).telegramUserId,
        trackId ?? null
      );
      if (!ok) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.status(204).end();
    })
  );

  /**
   * Whether friends see any of that.
   *
   * Its own route rather than a field on the status, so that the thing which
   * changes many times an hour and the thing which changes twice a year cannot
   * be sent in the same request — a status write must never be able to carry a
   * privacy setting with it, however the client is refactored later.
   */
  router.patch(
    "/privacy",
    requireAuth,
    asyncHandler(async (req, res) => {
      const { listeningPublic } = req.body ?? {};
      if (typeof listeningPublic !== "boolean") {
        res.status(400).json({ error: "listeningPublic must be true or false" });
        return;
      }

      await setListeningPrivacy(
        (req as AuthedRequest).telegramUserId,
        listeningPublic
      );
      res.json({ listening_public: listeningPublic });
    })
  );

  /**
   * Log a play. The client sends one per track, well into it — a seek is not a
   * play, and neither is skipping through six songs looking for one.
   *
   * Nothing is returned but a 204: the history this feeds is read back as a
   * list, and a client that had to reconcile a row would be a client that
   * cares when this call fails. It does not.
   */
  router.post(
    "/plays",
    requireAuth,
    asyncHandler(async (req, res) => {
      const { trackId } = req.body ?? {};
      if (typeof trackId !== "string") {
        res.status(400).json({ error: "trackId is required" });
        return;
      }

      const ok = await recordPlay((req as AuthedRequest).telegramUserId, trackId);
      if (!ok) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.status(204).end();
    })
  );

  /**
   * A picture the user chose themselves, replacing the Telegram profile photo.
   *
   * The client always sends an already-square, already-cropped image — see
   * ImageCropSheet — so there is nothing to do here but store it and mark it
   * custom, the same marker that stops the next /start from overwriting it.
   */
  router.post(
    "/avatar",
    requireAuth,
    upload.single("avatar"),
    asyncHandler(async (req, res) => {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "Missing avatar file" });
        return;
      }
      if (!COVER_TYPES.has(file.mimetype)) {
        res.status(400).json({ error: "Avatar must be a JPEG, PNG, WebP or GIF" });
        return;
      }

      const telegramUserId = (req as AuthedRequest).telegramUserId;
      const person = await getPerson(telegramUserId);
      const stored = await storeCover(
        file.buffer,
        file.mimetype,
        captionOf([`Avatar — ${personLabel(telegramUserId, person?.username)}`])
      );
      if (stored.kind !== "telegram") {
        res.status(503).json({ error: "Could not store that picture right now" });
        return;
      }

      await setCustomAvatar(telegramUserId, stored.fileId);
      res.status(204).end();
    })
  );

  /**
   * A rendered story card (see storyCard.ts), handed back as an HTTPS URL for
   * shareToStory — Telegram's story editor fetches the image itself, so a
   * blob: URL from the canvas that drew it is useless here, and it needs a
   * real address the way /avatar's picture never does.
   */
  router.post(
    "/story-card",
    requireAuth,
    upload.single("card"),
    asyncHandler(async (req, res) => {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: "Missing card file" });
        return;
      }
      if (!COVER_TYPES.has(file.mimetype)) {
        res.status(400).json({ error: "Card must be a JPEG, PNG, WebP or GIF" });
        return;
      }

      const telegramUserId = (req as AuthedRequest).telegramUserId;
      const person = await getPerson(telegramUserId);
      const stored = await storeCover(
        file.buffer,
        file.mimetype,
        captionOf([`Story card — ${personLabel(telegramUserId, person?.username)}`])
      );
      if (stored.kind !== "telegram") {
        res.status(503).json({ error: "Could not render that card right now" });
        return;
      }

      const origin = `${req.protocol}://${req.get("host")}`;
      res.json({ url: `${origin}/s/story/${encodeURIComponent(stored.fileId)}` });
    })
  );

  /**
   * The karaoke video twin of /story-card: the client already drew each
   * highlight frame and worked out how long it holds and which slice of the
   * track it plays over — this just needs the real audio, which only the
   * server can fetch from Telegram, and ffmpeg to stitch the two together.
   */
  router.post(
    "/story-video",
    requireAuth,
    storyVideoUpload.fields([{ name: "frames", maxCount: 20 }]),
    asyncHandler(async (req, res) => {
      const files = (req.files as Record<string, Express.Multer.File[]> | undefined)?.frames;
      if (!files?.length) {
        res.status(400).json({ error: "Missing frames" });
        return;
      }
      if (files.some((f) => f.mimetype !== "image/jpeg")) {
        res.status(400).json({ error: "Frames must be JPEG" });
        return;
      }

      const { trackId, manifest } = req.body ?? {};
      if (typeof trackId !== "string" || typeof manifest !== "string") {
        res.status(400).json({ error: "Missing trackId or manifest" });
        return;
      }

      let durations: unknown, clipStart: unknown, clipDuration: unknown;
      try {
        ({ durations, clipStart, clipDuration } = JSON.parse(manifest));
      } catch {
        res.status(400).json({ error: "Manifest is not valid JSON" });
        return;
      }
      if (
        !Array.isArray(durations) ||
        durations.length !== files.length ||
        !durations.every((d) => typeof d === "number" && d > 0) ||
        typeof clipStart !== "number" ||
        typeof clipDuration !== "number" ||
        clipStart < 0 ||
        clipDuration <= 0
      ) {
        res.status(400).json({ error: "Malformed manifest" });
        return;
      }

      const telegramUserId = (req as AuthedRequest).telegramUserId;
      const track = await getTrackForListener(trackId, telegramUserId);
      if (!track) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      // Clamped against the track's own length rather than trusted from the
      // client — a manifest is just numbers a browser sent us.
      const trackDuration = track.duration_seconds ?? clipStart + clipDuration;
      const start = Math.max(0, Math.min(clipStart, trackDuration));
      const duration = Math.max(0.1, Math.min(clipDuration, trackDuration - start));

      const downloadUrl = await getTelegramFileDownloadUrl(track.telegram_file_id);
      const audioRes = await fetch(downloadUrl);
      if (!audioRes.ok) {
        res.status(502).json({ error: "Failed to fetch audio from Telegram" });
        return;
      }
      const audio = Buffer.from(await audioRes.arrayBuffer());

      const video = await renderStoryVideo({
        frames: files.map((f) => f.buffer),
        durations,
        audio,
        clipStart: start,
        clipDuration: duration,
      });

      const person = await getPerson(telegramUserId);
      const fileId = await postCoverVideo(
        video,
        "video/mp4",
        captionOf([`Story video — ${personLabel(telegramUserId, person?.username)}`])
      );
      if (!fileId) {
        res.status(503).json({ error: "Could not render that video right now" });
        return;
      }

      const origin = `${req.protocol}://${req.get("host")}`;
      res.json({ url: `${origin}/s/story-video/${encodeURIComponent(fileId)}` });
    })
  );

  /** What this person has been listening to — top track, top artist, play count. */
  router.get(
    "/stats",
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(await getListeningStats((req as AuthedRequest).telegramUserId));
    })
  );

  /** One of the 8 presets from the accent-colour picker. */
  router.post(
    "/accent",
    requireAuth,
    asyncHandler(async (req, res) => {
      const { accentColor } = req.body ?? {};
      if (typeof accentColor !== "string" || !ACCENT_PRESETS.has(accentColor)) {
        res.status(400).json({ error: "Not a valid accent colour" });
        return;
      }

      await setAccentColor((req as AuthedRequest).telegramUserId, accentColor);
      res.json({ accent_color: accentColor });
    })
  );

  return router;
}
