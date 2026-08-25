import { Router } from "express";
import { validateInitData } from "../telegram-auth";
import { signSession } from "../jwt";
import { ensureUser } from "../repo";
import { required } from "../config";
import { asyncHandler } from "../asyncHandler";

export function authRouter(): Router {
  const router = Router();

  router.post("/telegram", asyncHandler(async (req, res) => {
    const { initData } = req.body ?? {};
    if (typeof initData !== "string" || initData.length === 0) {
      res.status(400).json({ error: "Missing initData" });
      return;
    }

    const validated = validateInitData(initData, required("BOT_TOKEN"));
    if (!validated) {
      res.status(401).json({ error: "Invalid initData" });
      return;
    }

    const { handle, listeningPublic } = await ensureUser(
      validated.user.id,
      validated.user.username
    );
    const token = signSession(validated.user.id, validated.user.username);
    // The identity comes back alongside the token because the client needs it
    // for every ownership decision it renders — whether to draw a heart, an
    // edit affordance, a Remove. Reading it from initDataUnsafe instead would
    // mean the UI trusting a value the server has just finished verifying.
    res.json({
      token,
      user: {
        id: validated.user.id,
        username: validated.user.username ?? null,
        first_name: validated.user.first_name ?? null,
        // Null means this account has never chosen a name in Navaar, which is
        // the one thing the client must handle before it can draw anything
        // else: there is no sensible way to render a person with no name.
        handle,
        // Whether their listening is shown to friends. Off for anybody who has
        // never said otherwise, and carried here so the switch on the profile
        // screen renders in the right position without a request of its own.
        listening_public: listeningPublic,
      },
    });
  }));

  return router;
}
