import { createHmac, timingSafeEqual } from "node:crypto";

export interface TelegramInitDataUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface ValidatedInitData {
  user: TelegramInitDataUser;
  authDate: number;
}

const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;

/**
 * Validates Telegram Mini App `initData` per Telegram's documented algorithm:
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateInitData(
  initData: string,
  botToken: string
): ValidatedInitData | null {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const computedHash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  const computedBuf = Buffer.from(computedHash, "hex");
  const providedBuf = Buffer.from(hash, "hex");
  if (
    computedBuf.length !== providedBuf.length ||
    !timingSafeEqual(computedBuf, providedBuf)
  ) {
    return null;
  }

  const authDateRaw = params.get("auth_date");
  const authDate = authDateRaw ? Number(authDateRaw) : NaN;
  if (!Number.isFinite(authDate)) return null;
  if (Date.now() / 1000 - authDate > MAX_AUTH_AGE_SECONDS) return null;

  const userRaw = params.get("user");
  if (!userRaw) return null;
  let user: TelegramInitDataUser;
  try {
    user = JSON.parse(userRaw);
  } catch {
    return null;
  }
  if (typeof user.id !== "number") return null;

  return { user, authDate };
}
