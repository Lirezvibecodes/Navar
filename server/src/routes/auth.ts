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

    await ensureUser(validated.user.id, validated.user.username);
    const token = signSession(validated.user.id, validated.user.username);
    res.json({ token });
  }));

  return router;
}
