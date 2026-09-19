import { Router } from "express";
import { requireAuth, AuthedRequest } from "../middleware";
import { asyncHandler } from "../asyncHandler";
import { getTagStates, setEquippedTags } from "../repo";
import { MAX_EQUIPPED_TAGS } from "../tags";

/**
 * Navaar Tags: the collectible identity layer, read and equipped here.
 * Separate from /api/users' endorsement-driven Taste Tier, which has its own
 * home in getUserProfile — a tag says how you use music, not how well other
 * people think you use it, and the two are never merged into one response.
 */
export function tagsRouter(): Router {
  const router = Router();

  /**
   * All 29 tags for the caller in one round trip: unlocked ones with their
   * date, locked public ones with live progress, locked secret ones with
   * nothing but their id, tier and vague clue. See getTagStates for exactly
   * what is and isn't computed per state.
   */
  router.get(
    "/",
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(await getTagStates((req as AuthedRequest).telegramUserId));
    })
  );

  /**
   * Replace the caller's equipped set. Body is `{ tagIds: string[] }`,
   * at most MAX_EQUIPPED_TAGS long and every id already unlocked — anything
   * else is a 400, not a silent partial apply. Responds with the caller's
   * fresh tag states so the client never has to guess whether the equip it
   * just sent actually landed before it renders.
   */
  router.put(
    "/equipped",
    requireAuth,
    asyncHandler(async (req, res) => {
      const { tagIds } = req.body ?? {};
      if (!Array.isArray(tagIds) || tagIds.some((id) => typeof id !== "string")) {
        res.status(400).json({ error: "tagIds must be an array of strings" });
        return;
      }
      if (tagIds.length > MAX_EQUIPPED_TAGS) {
        res.status(400).json({ error: `At most ${MAX_EQUIPPED_TAGS} tags can be equipped` });
        return;
      }

      const telegramUserId = (req as AuthedRequest).telegramUserId;
      const outcome = await setEquippedTags(telegramUserId, tagIds);
      if (outcome === "too-many") {
        res.status(400).json({ error: `At most ${MAX_EQUIPPED_TAGS} tags can be equipped` });
        return;
      }
      if (outcome === "not-unlocked") {
        res.status(400).json({ error: "One or more tags are not unlocked" });
        return;
      }

      res.json(await getTagStates(telegramUserId));
    })
  );

  return router;
}
