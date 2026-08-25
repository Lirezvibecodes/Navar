import { Router } from "express";
import { requireAuth, AuthedRequest } from "../middleware";
import { asyncHandler } from "../asyncHandler";
import { getHome } from "../repo";

/**
 * The first screen, as one request.
 *
 * Home is five shelves and this is one endpoint, deliberately: the landing
 * view is what wakes a sleeping instance, and five parallel calls would each
 * pay for that wake. There is no route here per section and no query string to
 * ask for one — the payload is the screen, and a section with nothing behind
 * it is simply absent from it.
 */
export function homeRouter(): Router {
  const router = Router();

  router.get(
    "/",
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(await getHome((req as AuthedRequest).telegramUserId));
    })
  );

  return router;
}
