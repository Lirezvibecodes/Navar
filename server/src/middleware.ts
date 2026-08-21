import type { NextFunction, Request, Response } from "express";
import { verifySession } from "./jwt";

export interface AuthedRequest extends Request {
  telegramUserId: number;
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const header = req.header("authorization");
  // Native <audio>/<img> tags can't set an Authorization header, so the
  // stream/cover routes also accept the session token as a query param.
  const token = header?.startsWith("Bearer ")
    ? header.slice(7)
    : typeof req.query.token === "string"
      ? req.query.token
      : undefined;
  if (!token) {
    res.status(401).json({ error: "Missing bearer token" });
    return;
  }

  const session = verifySession(token);
  if (!session) {
    res.status(401).json({ error: "Invalid or expired session" });
    return;
  }

  (req as AuthedRequest).telegramUserId = Number(session.sub);
  next();
}
