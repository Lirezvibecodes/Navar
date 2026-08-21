import jwt from "jsonwebtoken";
import { required } from "./config";

export interface SessionPayload {
  sub: string; // telegram_user_id as string
  username?: string;
}

const EXPIRY = "7d";

export function signSession(telegramUserId: number, username?: string): string {
  const payload: SessionPayload = { sub: String(telegramUserId), username };
  return jwt.sign(payload, required("JWT_SECRET"), { expiresIn: EXPIRY });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, required("JWT_SECRET")) as SessionPayload;
  } catch {
    return null;
  }
}
