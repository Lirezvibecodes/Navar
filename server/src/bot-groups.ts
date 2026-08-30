import type { Telegraf } from "telegraf";
import { Markup } from "telegraf";
import { miniAppLink } from "./bot-identity";
import {
  ensureGroupPlaylist,
  ensureUser,
  getGroupPlaylist,
  removeGroupMember,
  touchGroupMember,
} from "./repo";

/**
 * How a group message reaches the app.
 *
 * Not a `web_app` button: Telegram only accepts those in private chats, and
 * attaching one to a group message fails the whole send — which for the privacy
 * disclosure would mean the group never hears it. A URL button to the bot's
 * start-app link opens the same Mini App and is accepted anywhere.
 */
function openAppKeyboard() {
  const link = miniAppLink();
  return link
    ? Markup.inlineKeyboard([Markup.button.url("Open Navaar", link)])
    : undefined;
}

/** The two chat types where the bot is one participant among many. */
export function isGroupChat(chat: { type: string } | undefined): boolean {
  return chat?.type === "group" || chat?.type === "supergroup";
}

/** Whatever the group calls itself, with a fallback for a chat with no title. */
function crateName(chat: { title?: string }): string {
  return chat.title ? `${chat.title}` : "Group crate";
}

/**
 * What the group is told the moment the bot arrives.
 *
 * Telegram only delivers group messages to a bot when Group Privacy is turned
 * off in BotFather, which means this bot receives every message sent in the
 * chat — not only the music. That is a thing people have a right to know
 * before they say anything, so it is said first, in the group, in the words
 * anyone would use, and it is not buried under the feature description.
 */
function disclosure(chat: { title?: string }): string {
  return (
    `Navaar is in this chat, and there's something you should know before anything else.\n\n` +
    `Telegram only lets a bot work in a group if Group Privacy is switched off, ` +
    `so I receive every message sent here — not just the music. I don't store any of it. ` +
    `The only thing I keep is audio files: the track, its tags, its artwork, and who posted it.\n\n` +
    `Any audio posted from now on joins "${crateName(chat)}", a shared crate everyone ` +
    `in this chat can open in Navaar. Each track belongs to the person who posted it, ` +
    `and stays in their own library too.\n\n` +
    `I can't see anything sent before I joined, so nothing already in this chat will be picked up. ` +
    `Repost anything you want in the crate.\n\n` +
    `If any of that isn't what you want, remove me from the group.`
  );
}

/**
 * The bot's own membership changed somewhere. Only two transitions matter: it
 * was added to a group, and it was removed from one.
 */
export async function handleBotMembershipChange(
  bot: Telegraf,
  update: {
    chat: { id: number; type: string; title?: string };
    from: { id: number; username?: string; language_code?: string };
    old_chat_member: { status: string };
    new_chat_member: { status: string };
  }
): Promise<void> {
  if (!isGroupChat(update.chat)) return;

  const wasIn = isPresent(update.old_chat_member.status);
  const isIn = isPresent(update.new_chat_member.status);
  if (wasIn === isIn) return;
  if (!isIn) return;

  // The crate belongs to whoever added the bot: a playlist row needs an owner,
  // and a group is not one. Everyone else reaches it through group_members.
  const adderId = update.from.id;
  await ensureUser(adderId, update.from.username, update.from.language_code);
  await touchGroupMember(update.chat.id, adderId);

  const { created } = await ensureGroupPlaylist(
    update.chat.id,
    adderId,
    crateName(update.chat)
  );

  // Said once per chat. Re-adding a bot to a group it was already set up in
  // should not replay the announcement.
  if (!created) return;

  await postDisclosure(bot, update.chat);
}

/**
 * The disclosure is mandatory, so its failure is loud in the log and never
 * takes the update that triggered it down with it.
 */
async function postDisclosure(
  bot: Telegraf,
  chat: { id: number; title?: string }
): Promise<void> {
  try {
    await bot.telegram.sendMessage(chat.id, disclosure(chat), openAppKeyboard());
  } catch (err) {
    console.error("[groups] could not post the privacy disclosure:", err);
  }
}

/** Statuses that mean the bot can actually see the chat. */
function isPresent(status: string): boolean {
  return status === "member" || status === "administrator" || status === "creator";
}

/**
 * Note that someone is in this chat.
 *
 * Called for every group update the bot receives, because that is the only way
 * the list is ever built — there is no API to ask Telegram who is in a group.
 * Never allowed to fail or delay the update it was observed from.
 */
export function noteGroupPresence(ctx: {
  chat?: { id: number; type: string };
  from?: { id: number; username?: string; is_bot?: boolean; language_code?: string };
}): void {
  const chat = ctx.chat;
  const from = ctx.from;
  if (!chat || !isGroupChat(chat) || !from || from.is_bot) return;

  void rememberMember(chat.id, from.id, from.username, from.language_code);
}

/** Someone joined the chat, so they can see its crate from now on. */
export function noteGroupJoins(
  chatId: number,
  members: { id: number; username?: string; is_bot?: boolean; language_code?: string }[]
): void {
  for (const member of members) {
    if (member.is_bot) continue;
    void rememberMember(chatId, member.id, member.username, member.language_code);
  }
}

/** Someone left, so the crate stops being theirs to see. */
export function noteGroupDeparture(chatId: number, userId: number): void {
  void removeGroupMember(chatId, userId).catch((err) => {
    console.error("[groups] could not drop a departed member:", err);
  });
}

async function rememberMember(
  chatId: number,
  userId: number,
  username: string | undefined,
  languageCode: string | undefined
): Promise<void> {
  try {
    // The membership row references users, so the user row has to exist first.
    await ensureUser(userId, username, languageCode);
    await touchGroupMember(chatId, userId);
  } catch (err) {
    console.error("[groups] could not record group membership:", err);
  }
}

/**
 * The crate a group's audio belongs in.
 *
 * Usually already there, created when the bot joined. It is created here too,
 * for the chats where that update never arrived — the bot was added while the
 * service was asleep, or added before this existed. The disclosure goes with
 * it: a crate must never come into being without the group being told.
 */
export async function crateForGroup(
  bot: Telegraf,
  chat: { id: number; type: string; title?: string },
  fallbackOwnerId: number
): Promise<{ playlistId: string; created: boolean }> {
  const existing = await getGroupPlaylist(chat.id);
  if (existing) return { playlistId: existing.id, created: false };

  const { playlist, created } = await ensureGroupPlaylist(
    chat.id,
    fallbackOwnerId,
    crateName(chat)
  );
  if (created) await postDisclosure(bot, chat);
  return { playlistId: playlist.id, created };
}

/** The one message a group gets about its crate filling up: the first track. */
export async function announceCrateOpened(
  bot: Telegraf,
  chat: { id: number; title?: string }
): Promise<void> {
  try {
    await bot.telegram.sendMessage(
      chat.id,
      `"${crateName(chat)}" has its first track. Everything posted here from now on joins it.`,
      openAppKeyboard()
    );
  } catch (err) {
    console.error("[groups] could not announce the crate:", err);
  }
}
