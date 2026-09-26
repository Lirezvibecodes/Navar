import { randomBytes } from "node:crypto";

/**
 * Signing in to the installed web app (the PWA) through the bot.
 *
 * Outside Telegram there is no initData to prove who someone is, so the app
 * borrows the bot instead: it asks for a one-time code, opens
 * t.me/<bot>?start=login_<code>, and polls. In the chat the bot asks the
 * person to confirm, and the confirmation is what binds the code to their
 * Telegram account. The next poll trades the code for a session, once.
 *
 * The confirm step is not ceremony. Without it, anybody could send someone a
 * login link of their own and the victim tapping Start would sign the sender
 * in as the victim. The bot's prompt says which device is asking and to
 * refuse if it was not them.
 *
 * Codes live in memory: they last five minutes, the free tier runs a single
 * instance, and a restart costs somebody one more tap of "Log in".
 */

const TTL_MS = 5 * 60 * 1000;
const MAX_PENDING = 1000;

export interface LoginIdentity {
  id: number;
  username?: string;
  first_name?: string;
  language_code?: string;
}

interface Pending {
  expiresAt: number;
  device: string;
  confirmed: LoginIdentity | null;
}

const pending = new Map<string, Pending>();

/** 22 URL-safe characters: fits Telegram's 64-character start payload. */
export const LOGIN_CODE = /^[A-Za-z0-9_-]{22}$/;

function sweep(now: number): void {
  for (const [code, entry] of pending) {
    if (entry.expiresAt <= now) pending.delete(code);
  }
  // Insertion order is age order, so the oldest go first if someone is
  // hammering the endpoint.
  while (pending.size >= MAX_PENDING) {
    const oldest = pending.keys().next().value;
    if (oldest === undefined) break;
    pending.delete(oldest);
  }
}

export function createLoginCode(device: string): { code: string; expiresAt: number } {
  const now = Date.now();
  sweep(now);
  const code = randomBytes(16).toString("base64url");
  const expiresAt = now + TTL_MS;
  pending.set(code, { expiresAt, device, confirmed: null });
  return { code, expiresAt };
}

function live(code: string): Pending | null {
  const entry = pending.get(code);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    pending.delete(code);
    return null;
  }
  return entry;
}

/** What the bot shows when asking for confirmation, or null if the code is gone. */
export function describeLoginCode(code: string): { device: string } | null {
  const entry = live(code);
  return entry && !entry.confirmed ? { device: entry.device } : null;
}

export function confirmLoginCode(code: string, who: LoginIdentity): boolean {
  const entry = live(code);
  if (!entry || entry.confirmed) return false;
  entry.confirmed = who;
  return true;
}

export function cancelLoginCode(code: string): void {
  pending.delete(code);
}

/**
 * "pending" while waiting on the person in Telegram, the identity exactly once
 * after they confirm, and null for a code that expired, was cancelled or was
 * already used.
 */
export function redeemLoginCode(code: string): LoginIdentity | "pending" | null {
  const entry = live(code);
  if (!entry) return null;
  if (!entry.confirmed) return "pending";
  pending.delete(code);
  return entry.confirmed;
}

/** "Safari on iPhone", "Chrome on Android" — enough to recognise your own device. */
export function describeDevice(userAgent: string | undefined): string {
  const ua = userAgent ?? "";
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : "an unknown device";
  const browser = /EdgA?\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox|FxiOS/.test(ua)
        ? "Firefox"
        : /Chrome|CriOS/.test(ua)
          ? "Chrome"
          : /Safari/.test(ua)
            ? "Safari"
            : "a browser";
  return `${browser} on ${os}`;
}
