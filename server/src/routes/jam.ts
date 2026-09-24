import { Response, Router } from "express";
import { requireAuth, AuthedRequest } from "../middleware";
import { asyncHandler } from "../asyncHandler";
import {
  acceptJamRequest,
  addToJamQueue,
  cancelJamRequest,
  declineJamRequest,
  getJamState,
  JamError,
  JamResult,
  leaveJam,
  moveJamQueueItem,
  removeFromJamQueue,
  removeJamParticipant,
  syncJam,
} from "../jam";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A path or body value that has to be a row id; anything else is a miss, not a 500. */
export function readUuid(raw: unknown): string | null {
  return typeof raw === "string" && UUID.test(raw) ? raw : null;
}

/**
 * How each refusal reads on the wire. Anything the caller may not know exists
 * is a 404, the same as the rest of the API; a state that stands between the
 * caller and what they asked for is a 409 whose message the client can show.
 */
const JAM_ERRORS: Record<JamError, [number, string]> = {
  not_found: [404, "Not found"],
  not_live: [409, "They aren't listening right now"],
  in_jam: [409, "Already in a jam"],
  host_busy: [409, "They're in someone else's jam"],
  full: [409, "This jam is full"],
  pending_elsewhere: [409, "You already have a request waiting"],
  gone: [409, "This request is no longer open"],
  forbidden: [403, "Not allowed"],
  duplicate: [409, "That song is already in the queue"],
  queue_full: [409, "The jam queue is full"],
};

export function sendJamError(res: Response, error: JamError): void {
  const [status, message] = JAM_ERRORS[error];
  res.status(status).json({ error: message, code: error });
}

/**
 * Every write answers with the caller's fresh poll, so the client redraws
 * from what the server now holds rather than guessing at the effect.
 */
async function answer(res: Response, userId: number, result: JamResult<unknown>): Promise<void> {
  if (!result.ok) {
    sendJamError(res, result.error);
    return;
  }
  res.json(await getJamState(userId));
}

export function jamRouter(): Router {
  const router = Router();
  const uid = (req: unknown) => (req as AuthedRequest).telegramUserId;

  /** The poll, and the heartbeat that keeps the caller in their jam. */
  router.get(
    "/",
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(await getJamState(uid(req)));
    })
  );

  router.delete(
    "/requests/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      const id = readUuid(req.params.id);
      await answer(res, uid(req), id ? await cancelJamRequest(uid(req), id) : { ok: false, error: "not_found" });
    })
  );

  router.post(
    "/requests/:id/accept",
    requireAuth,
    asyncHandler(async (req, res) => {
      const id = readUuid(req.params.id);
      await answer(res, uid(req), id ? await acceptJamRequest(uid(req), id) : { ok: false, error: "not_found" });
    })
  );

  router.post(
    "/requests/:id/decline",
    requireAuth,
    asyncHandler(async (req, res) => {
      const id = readUuid(req.params.id);
      await answer(res, uid(req), id ? await declineJamRequest(uid(req), id) : { ok: false, error: "not_found" });
    })
  );

  /**
   * The host reports playback. Deliberately answered with 204, not a poll:
   * it fires on every play, pause, seek and track change, and the host polls
   * on its own interval anyway.
   */
  router.post(
    "/sync",
    requireAuth,
    asyncHandler(async (req, res) => {
      const { trackId, itemId, position, playing } = req.body ?? {};
      const track = trackId == null ? null : readUuid(trackId);
      if (trackId != null && !track) {
        res.status(400).json({ error: "trackId must be a track or null" });
        return;
      }
      if (typeof position !== "number" || !Number.isFinite(position) || position < 0) {
        res.status(400).json({ error: "position must be a number of seconds" });
        return;
      }
      if (typeof playing !== "boolean") {
        res.status(400).json({ error: "playing must be true or false" });
        return;
      }
      const result = await syncJam(uid(req), {
        trackId: track,
        itemId: readUuid(itemId),
        position,
        playing,
      });
      if (!result.ok) {
        sendJamError(res, result.error);
        return;
      }
      res.status(204).end();
    })
  );

  router.post(
    "/leave",
    requireAuth,
    asyncHandler(async (req, res) => {
      await answer(res, uid(req), await leaveJam(uid(req)));
    })
  );

  router.delete(
    "/participants/:userId",
    requireAuth,
    asyncHandler(async (req, res) => {
      const target = Number(req.params.userId);
      if (!Number.isSafeInteger(target) || target <= 0) {
        sendJamError(res, "not_found");
        return;
      }
      await answer(res, uid(req), await removeJamParticipant(uid(req), target));
    })
  );

  router.post(
    "/queue",
    requireAuth,
    asyncHandler(async (req, res) => {
      const { trackId, next } = req.body ?? {};
      const track = readUuid(trackId);
      if (!track) {
        res.status(400).json({ error: "trackId must be a track" });
        return;
      }
      await answer(res, uid(req), await addToJamQueue(uid(req), track, next === true));
    })
  );

  router.delete(
    "/queue/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      const id = readUuid(req.params.id);
      await answer(res, uid(req), id ? await removeFromJamQueue(uid(req), id) : { ok: false, error: "not_found" });
    })
  );

  router.patch(
    "/queue/:id",
    requireAuth,
    asyncHandler(async (req, res) => {
      const id = readUuid(req.params.id);
      const { toIndex } = req.body ?? {};
      if (!Number.isInteger(toIndex) || toIndex < 0) {
        res.status(400).json({ error: "toIndex must be a position in the queue" });
        return;
      }
      await answer(res, uid(req), id ? await moveJamQueueItem(uid(req), id, toIndex) : { ok: false, error: "not_found" });
    })
  );

  return router;
}
