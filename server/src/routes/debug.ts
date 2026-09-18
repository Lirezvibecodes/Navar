import { Router } from "express";
import { requireAuth, AuthedRequest } from "../middleware";
import { asyncHandler } from "../asyncHandler";

/**
 * TEMPORARY — diagnostic-only route for the Home scroll bug.
 *
 * Lets the client ship its on-screen touch-event log to the server instead of
 * requiring someone to transcribe an overlay by hand. Writes require a real
 * session so only signed-in clients can post; reads are gated by a throwaway
 * key (DEBUG_READ_KEY, set only on Render, never committed) instead of a
 * session because the one reading is the developer's own curl, not a
 * Telegram session. In-memory only — a redeploy or restart clears it, which
 * is fine since this is meant to live for a day at most. Delete this whole
 * file (and its mount in app.ts) once the bug is found.
 */
const MAX_ENTRIES = 300;

interface Entry {
  at: string;
  telegramUserId: number;
  lines: string[];
}

const entries: Entry[] = [];

export function debugRouter(): Router {
  const router = Router();

  router.post(
    "/touch-log",
    requireAuth,
    asyncHandler(async (req, res) => {
      const lines = Array.isArray(req.body?.lines)
        ? req.body.lines.filter((l: unknown): l is string => typeof l === "string").slice(0, 50)
        : [];
      if (lines.length > 0) {
        entries.push({
          at: new Date().toISOString(),
          telegramUserId: (req as AuthedRequest).telegramUserId,
          lines,
        });
        while (entries.length > MAX_ENTRIES) entries.shift();
      }
      res.status(204).end();
    })
  );

  router.get(
    "/touch-log",
    (req, res, next) => {
      const key = process.env.DEBUG_READ_KEY;
      if (!key || req.header("x-debug-key") !== key) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
      next();
    },
    (_req, res) => {
      res.json({ entries });
    }
  );

  return router;
}
