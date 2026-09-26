import jwt from "jsonwebtoken";
import { required } from "./config";

export interface SessionPayload {
  sub: string; // telegram_user_id as string
  username?: string;
  /**
   * Set on sessions for the installed web app, which signed in through the
   * bot. The Mini App proves itself afresh with initData on every open and
   * never needs to renew; a device session has nothing to prove itself with
   * but this token, so it lasts longer and renews while it is used.
   */
  device?: true;
  /** Kept on device sessions, which cannot read it back from initData. */
  first_name?: string;
}

const EXPIRY = "7d";
const DEVICE_EXPIRY = "90d";

export function signSession(telegramUserId: number, username?: string): string {
  const payload: SessionPayload = { sub: String(telegramUserId), username };
  return jwt.sign(payload, required("JWT_SECRET"), { expiresIn: EXPIRY });
}

export function signDeviceSession(
  telegramUserId: number,
  username?: string,
  firstName?: string
): string {
  const payload: SessionPayload = {
    sub: String(telegramUserId),
    username,
    device: true,
    first_name: firstName,
  };
  return jwt.sign(payload, required("JWT_SECRET"), { expiresIn: DEVICE_EXPIRY });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, required("JWT_SECRET")) as SessionPayload;
  } catch {
    return null;
  }
}
