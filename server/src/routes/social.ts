import { Router } from "express";
import { requireAuth, AuthedRequest } from "../middleware";
import { asyncHandler } from "../asyncHandler";
import { listSocialActivity } from "../repo";

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

  return router;
}
