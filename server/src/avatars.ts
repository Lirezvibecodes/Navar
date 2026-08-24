import type { Telegraf } from "telegraf";
import { setUserAvatarFileId } from "./repo";

/**
 * Capture the user's current Telegram profile photo as a file_id.
 *
 * Called on /start rather than per request. getUserProfilePhotos is a Bot API
 * round trip, so resolving it when a friends list renders would mean one call
 * per face; doing it when the user talks to the bot costs nothing extra and is
 * fresh enough for a picture that changes a few times a year.
 *
 * Having no photo is the normal outcome for a large share of accounts — hidden
 * by privacy settings, or never set. That writes NULL and is not logged as a
 * problem; the client draws its own fallback. Only an actual API failure is
 * worth a line, and even then it must not take the /start reply down with it.
 */
export async function refreshAvatar(bot: Telegraf, telegramUserId: number): Promise<void> {
  try {
    const photos = await bot.telegram.getUserProfilePhotos(telegramUserId, 0, 1);
    // Each photo comes as a size ladder, smallest first. The last entry is the
    // largest; the app never shows an avatar above 50px, so take the smallest
    // that Telegram offers and keep the proxied bytes small.
    const fileId = photos.photos[0]?.[0]?.file_id ?? null;
    await setUserAvatarFileId(telegramUserId, fileId);
  } catch (err) {
    console.error("[avatars] could not refresh profile photo:", err);
  }
}
