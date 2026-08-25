import { Router } from "express";
import { requireAuth, AuthedRequest } from "../middleware";
import { asyncHandler } from "../asyncHandler";
import {
  acceptFriendship,
  listFriends,
  listFriendsListening,
  listOutgoingFriendRequests,
  listPendingFriendRequests,
  removeFriendship,
  requestFriendship,
} from "../repo";
import { friendInviteLink } from "../bot-identity";

/** Rejects a path parameter that is not a Telegram user id. */
function readUserId(raw: string): number | null {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function friendsRouter(): Router {
  const router = Router();

  router.get(
    "/",
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(await listFriends((req as AuthedRequest).telegramUserId));
    })
  );

  /**
   * Requests waiting on this user, plus the ids of the ones they have sent —
   * the latter so the Social tab can render a "Pending" pill instead of an
   * "Add" button without a second request.
   *
   * Declared before /:id so "pending" is not read as a user id.
   */
  router.get(
    "/pending",
    requireAuth,
    asyncHandler(async (req, res) => {
      const userId = (req as AuthedRequest).telegramUserId;
      const [incoming, outgoing] = await Promise.all([
        listPendingFriendRequests(userId),
        listOutgoingFriendRequests(userId),
      ]);
      res.json({ incoming, outgoing });
    })
  );

  /**
   * Who is playing something right now.
   *
   * Only friends who turned their listening on, and only within the last few
   * minutes. Everybody else is absent rather than present-and-hidden: a row
   * saying somebody has opted out is a row that tells you the one thing they
   * opted out of telling you.
   *
   * Declared before /:id for the same reason /pending is.
   */
  router.get(
    "/listening",
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(await listFriendsListening((req as AuthedRequest).telegramUserId));
    })
  );

  /**
   * The user's own invite link. Unavailable in API-only mode, where there is no
   * bot to deep-link into.
   */
  router.get(
    "/link",
    requireAuth,
    asyncHandler(async (req, res) => {
      const link = friendInviteLink((req as AuthedRequest).telegramUserId);
      if (!link) {
        res.status(503).json({ error: "Invite links are unavailable" });
        return;
      }
      res.json({ link });
    })
  );

  /** Send a request. The deep link does the same thing from inside Telegram. */
  router.post(
    "/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      const target = readUserId(req.params.id);
      if (!target) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      const outcome = await requestFriendship(
        (req as AuthedRequest).telegramUserId,
        target
      );
      if (outcome === "self") {
        res.status(400).json({ error: "You cannot add yourself" });
        return;
      }
      res.json({ outcome });
    })
  );

  router.post(
    "/:id/accept",
    requireAuth,
    asyncHandler(async (req, res) => {
      const requester = readUserId(req.params.id);
      // A request that is not there to accept is indistinguishable from one
      // addressed to somebody else, and gets the same answer.
      if (!requester || !(await acceptFriendship((req as AuthedRequest).telegramUserId, requester))) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.status(204).end();
    })
  );

  /** Declining a request and unfriending are the same call. */
  router.delete(
    "/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      const other = readUserId(req.params.id);
      if (!other || !(await removeFriendship((req as AuthedRequest).telegramUserId, other))) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.status(204).end();
    })
  );

  return router;
}
