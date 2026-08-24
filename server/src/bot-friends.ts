import type { Telegraf } from "telegraf";
import { Markup } from "telegraf";
import {
  acceptFriendship,
  getPerson,
  removeFriendship,
  requestFriendship,
  type PersonSummary,
} from "./repo";

/**
 * What to call someone in a message. Usernames are optional, so this falls back
 * to the name Telegram gave us and, failing that, says nothing identifying at
 * all rather than printing a bare numeric id at the user.
 */
export function displayName(
  person: Pick<PersonSummary, "username"> | null,
  fallbackName?: string
): string {
  if (person?.username) return `@${person.username}`;
  return fallbackName ?? "Someone";
}

/**
 * Handle a `?start=friend_<id>` deep link.
 *
 * This is the primary way friendships are made: the link carries the numeric
 * id, so it survives username changes and typos, and it works from any chat the
 * sender can paste into. Username search exists in the app as a fallback.
 *
 * Both parties always hear about it. A request that only appears in the app is
 * a request nobody sees, because the app is not where these conversations
 * start.
 */
export async function handleFriendInvite(
  bot: Telegraf,
  from: { id: number; username?: string; first_name?: string },
  targetId: number,
  reply: (text: string) => Promise<unknown>
): Promise<void> {
  if (targetId === from.id) {
    await reply(
      "That's your own invite link. Send it to someone else and they'll be added when they tap it."
    );
    return;
  }

  const target = await getPerson(targetId);
  if (!target) {
    // Either a mangled link or an account that has never opened Navaar. There
    // is nothing to request against and nothing useful to say about which.
    await reply("That invite link doesn't point at anyone I know. Ask them for a fresh one.");
    return;
  }

  const theirName = displayName(target);
  const outcome = await requestFriendship(from.id, targetId);

  switch (outcome) {
    case "already_friends":
      await reply(`You and ${theirName} are already friends.`);
      return;

    case "already_requested":
      await reply(`You've already asked ${theirName}. I'll tell you when they answer.`);
      return;

    case "accepted": {
      // They had already asked us, so tapping their link is the answer.
      await reply(`You and ${theirName} are now friends.`);
      await sendQuietly(
        bot,
        targetId,
        `${displayName({ username: from.username ?? null }, from.first_name)} accepted your friend request.`
      );
      return;
    }

    case "requested": {
      await reply(`Asked ${theirName} to be friends. I'll tell you when they answer.`);
      await sendQuietly(
        bot,
        targetId,
        `${displayName({ username: from.username ?? null }, from.first_name)} wants to be friends on Navaar.`,
        Markup.inlineKeyboard([
          Markup.button.callback("Accept", `friend_accept_${from.id}`),
          Markup.button.callback("Decline", `friend_decline_${from.id}`),
        ])
      );
      return;
    }

    case "self":
      return;
  }
}

/**
 * The accept/decline buttons on the request message.
 *
 * Accepting tells both people. Declining tells only the person who declined:
 * "they said no" is not information the sender is owed, and withholding it is
 * what makes declining a comfortable thing to do.
 */
export function registerFriendActions(bot: Telegraf): void {
  bot.action(/^friend_accept_(\d+)$/, async (ctx) => {
    const requesterId = Number(ctx.match[1]);
    const accepted = await acceptFriendship(ctx.from.id, requesterId);
    await ctx.answerCbQuery(accepted ? "Friends" : "That request is no longer there");

    const requester = await getPerson(requesterId);
    await editOrIgnore(
      ctx,
      accepted
        ? `You and ${displayName(requester)} are now friends.`
        : "That request is no longer there."
    );

    if (accepted) {
      await sendQuietly(
        bot,
        requesterId,
        `${displayName({ username: ctx.from.username ?? null }, ctx.from.first_name)} accepted your friend request.`
      );
    }
  });

  bot.action(/^friend_decline_(\d+)$/, async (ctx) => {
    const requesterId = Number(ctx.match[1]);
    await removeFriendship(ctx.from.id, requesterId);
    await ctx.answerCbQuery("Declined");
    await editOrIgnore(ctx, "Declined. They won't be told.");
  });
}

/**
 * Send a message to someone who is not the person we are currently replying to.
 *
 * They may have blocked the bot or never started it, and Telegram answers with
 * a 403 in both cases. That must not fail the request the other party made, so
 * it is logged and swallowed.
 */
async function sendQuietly(
  bot: Telegraf,
  chatId: number,
  text: string,
  extra?: Parameters<Telegraf["telegram"]["sendMessage"]>[2]
): Promise<void> {
  try {
    await bot.telegram.sendMessage(chatId, text, extra);
  } catch (err) {
    console.error(`[friends] could not notify ${chatId}:`, err);
  }
}

/** Replacing the buttons with the outcome, tolerating an already-edited message. */
async function editOrIgnore(
  ctx: { editMessageText: (text: string) => Promise<unknown> },
  text: string
): Promise<void> {
  try {
    await ctx.editMessageText(text);
  } catch {
    // Telegram rejects an edit that changes nothing, and the message may have
    // been deleted. Neither is worth surfacing.
  }
}
