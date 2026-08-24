import { Router } from "express";
import { requireAuth, AuthedRequest } from "../middleware";
import { asyncHandler } from "../asyncHandler";
import { setHandle } from "../repo";
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

  return router;
}
