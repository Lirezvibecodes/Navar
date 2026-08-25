import { Router } from "express";
import { requireAuth, AuthedRequest } from "../middleware";
import { asyncHandler } from "../asyncHandler";
import { listFriendSuggestions, listSocialActivity } from "../repo";

/**
 * What the people you know have been doing.
 *
 * One endpoint, because the Social tab is one screen and the free instance
 * charges by the request rather than by the row. It is also the only endpoint
 * in Navaar that is refetched on a schedule, and only while the tab that shows
 * it is on screen — the client owns that rule, and there is nothing here that
 * rewards being asked more often than the listening window is long.
 */
export function socialRouter(): Router {
  const router = Router();

  router.get(
    "/activity",
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(await listSocialActivity((req as AuthedRequest).telegramUserId));
    })
  );

  /**
   * People your friends know.
   *
   * Two hops and no further, ordered by how many friends you have in common,
   * and never anybody you are already connected to or have already asked. It
   * is a separate call from the feed above because it is asked once when the
   * screen opens and not again — putting it in the payload that refetches
   * every thirty seconds would re-walk the friend graph for an answer that
   * cannot have changed.
   *
   * Empty is the ordinary answer for somebody with no friends yet, and the
   * client is expected to render nothing rather than an explanation.
   */
  router.get(
    "/suggestions",
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(await listFriendSuggestions((req as AuthedRequest).telegramUserId));
    })
  );

  return router;
}
