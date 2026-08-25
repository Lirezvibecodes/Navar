import { Router } from "express";
import { requireAuth, AuthedRequest } from "../middleware";
import { asyncHandler } from "../asyncHandler";
import {
  recordPlay,
  setHandle,
  setListeningPrivacy,
  setListeningStatus,
} from "../repo";
import { HANDLE_RULE, normaliseHandle } from "../handles";

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

  return router;
}
