/**
 * The bot's own @username, needed to build friend deep links.
 *
 * It is resolved once at startup with getMe rather than configured, so there is
 * no env var to forget or to drift out of step after a rename in BotFather.
 * API-only mode (no BOT_TOKEN) leaves it unset, and every consumer has to cope
 * with that — an invite link is simply unavailable rather than wrong.
 */
let botUsername: string | null = null;

export function setBotUsername(username: string): void {
  botUsername = username;
}

/**
 * The link a user shares to add someone as a friend.
 *
 * A deep link is the primary path on purpose: usernames are optional, get
 * changed, and are easy to mistype, whereas this carries the numeric id and
 * works from any chat the user can paste into.
 */
export function friendInviteLink(telegramUserId: number): string | null {
  if (!botUsername) return null;
  return `https://t.me/${botUsername}?start=friend_${telegramUserId}`;
}

/**
 * A link that opens the Mini App, for use where an inline `web_app` button
 * cannot go. Telegram only allows those in one-to-one chats with the bot, so
 * every message the bot sends into a group has to reach the app this way
 * instead — a plain URL button pointing at the bot's own start-app link.
 */
export function miniAppLink(): string | null {
  if (!botUsername) return null;
  return `https://t.me/${botUsername}?startapp`;
}
