import { Router } from "express";
import { validateInitData } from "../telegram-auth";
import { signDeviceSession, signSession, verifySession } from "../jwt";
import { ensureUser, touchPresence } from "../repo";
import { required } from "../config";
import { asyncHandler } from "../asyncHandler";
import { botChatLink, botLoginLink, miniAppLink } from "../bot-identity";
import {
  LOGIN_CODE,
  createLoginCode,
  describeDevice,
  redeemLoginCode,
  type LoginIdentity,
} from "../bot-login";

/**
 * The account as the client needs it, for a session that has just been
 * issued. Shared by every way of signing in so they cannot drift apart.
 */
async function sessionUser(who: LoginIdentity) {
  const { handle, listeningPublic, accentColor } = await ensureUser(
    who.id,
    who.username,
    who.language_code
  );
  // Signing in is opening the app, which is what friends see as online.
  // Fire-and-forget: a failed stamp must never cost anybody their sign-in.
  void touchPresence(who.id).catch(() => undefined);
  return {
    id: who.id,
    username: who.username ?? null,
    first_name: who.first_name ?? null,
    handle,
    listening_public: listeningPublic,
    accent_color: accentColor,
  };
}

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

    const token = signSession(validated.user.id, validated.user.username);
    // The identity comes back alongside the token because the client needs it
    // for every ownership decision it renders — whether to draw a heart, an
    // edit affordance, a Remove. Reading it from initDataUnsafe instead would
    // mean the UI trusting a value the server has just finished verifying.
    res.json({ token, user: await sessionUser(validated.user) });
  }));

  /**
   * The installed web app, which has no initData: start a sign-in through the
   * bot. See bot-login.ts for the whole exchange and why the bot asks first.
   */
  router.post("/bot-login", (req, res) => {
    const { code, expiresAt } = createLoginCode(describeDevice(req.header("user-agent")));
    const link = botLoginLink(code);
    if (!link) {
      res.status(503).json({ error: "Signing in through Telegram is unavailable right now" });
      return;
    }
    res.json({ code, link, expiresAt });
  });

  router.get("/bot-login/:code", asyncHandler(async (req, res) => {
    const code = req.params.code;
    if (!LOGIN_CODE.test(code)) {
      res.status(400).json({ error: "Bad code" });
      return;
    }
    const result = redeemLoginCode(code);
    if (result === "pending") {
      res.status(202).json({ status: "pending" });
      return;
    }
    if (!result) {
      res.status(410).json({ error: "This sign-in expired. Start again." });
      return;
    }
    const user = await sessionUser(result);
    res.json({ token: signDeviceSession(result.id, result.username, result.first_name), user });
  }));

  /** Where the bot is, for the install page's "Open in Telegram". Public. */
  router.get("/bot-info", (_req, res) => {
    res.json({ chat: botChatLink(), miniApp: miniAppLink() });
  });

  /**
   * Renews a device session and returns the account, so an installed app
   * that is used at least once every ninety days never has to sign in again.
   * Mini App sessions are refused: they sign in afresh on every open anyway.
   */
  router.post("/refresh", asyncHandler(async (req, res) => {
    const header = req.header("authorization");
    const session = header?.startsWith("Bearer ") ? verifySession(header.slice(7)) : null;
    if (!session?.device) {
      res.status(401).json({ error: "Invalid or expired session" });
      return;
    }
    const id = Number(session.sub);
    const user = await sessionUser({ id, username: session.username, first_name: session.first_name });
    res.json({ token: signDeviceSession(id, session.username, session.first_name), user });
  }));

  return router;
}
