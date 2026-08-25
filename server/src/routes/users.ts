import { Router } from "express";
import { Readable } from "node:stream";
import { requireAuth, AuthedRequest } from "../middleware";
import { asyncHandler } from "../asyncHandler";
import {
  endorsePerson,
  getUserAvatarFileId,
  getUserProfile,
  listPlaylistsVisibleTo,
  searchPeople,
} from "../repo";
import { getTelegramFileDownloadUrl } from "../telegram-files";

/** Rejects a path parameter that is not a Telegram user id. */
function readUserId(raw: string): number | null {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function usersRouter(): Router {
  const router = Router();

  /**
   * Find people whose name starts with what was typed.
   *
   * A short query is answered with an empty list rather than an error: the
   * client types into this as the letters arrive, and the first keystroke
   * being a failure would make every search flash a message on its way to a
   * result. The floor and the cap both live in the repo, where the query is.
   *
   * Declared before /:id/... so a search is never read as a user id.
   */
  router.get(
    "/search",
    requireAuth,
    asyncHandler(async (req, res) => {
      const q = typeof req.query.q === "string" ? req.query.q : "";
      res.json(await searchPeople((req as AuthedRequest).telegramUserId, q));
    })
  );

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
      const userId = readUserId(req.params.id);
      if (!userId) {
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
   * Somebody's page: who they are, where the requester stands with them, what
   * they have earned, and whatever of theirs the requester may open.
   *
   * There is one route rather than a public one and a private one. What a
   * stranger sees is not a different endpoint, it is the same endpoint
   * returning less, because every part of the answer is scoped by the reader
   * that produced it.
   */
  router.get(
    "/:id/profile",
    requireAuth,
    asyncHandler(async (req, res) => {
      const userId = readUserId(req.params.id);
      const profile = userId
        ? await getUserProfile((req as AuthedRequest).telegramUserId, userId)
        : null;
      if (!profile) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json(profile);
    })
  );

  /**
   * Say that somebody's taste is worth following.
   *
   * The 403 here is the one place in this API that says "no" rather than
   * "there is nothing here", and it is deliberate: this is not a resource
   * being hidden, it is an action with a condition, and the person asking
   * already knows the account exists because they are looking at it. Whether
   * the condition is met is decided by the insert itself — see the repo.
   *
   * Endorsing twice is not an error. The first one already said it.
   */
  router.post(
    "/:id/endorse",
    requireAuth,
    asyncHandler(async (req, res) => {
      const userId = readUserId(req.params.id);
      if (!userId) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      const outcome = await endorsePerson(
        (req as AuthedRequest).telegramUserId,
        userId
      );
      if (outcome === "not-earned") {
        res.status(403).json({
          error: "Keep something of theirs first",
        });
        return;
      }
      res.status(204).end();
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
      const ownerId = readUserId(req.params.id);
      if (!ownerId) {
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
