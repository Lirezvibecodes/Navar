import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { config } from "./config";
import {
  ingestAudioMessage,
  ingestGroupAudioMessage,
  AudioTooLargeError,
  IncomingAudio,
} from "./audio-ingest";
import { resolveCoverArt } from "./cover-art";
import { ensureUser, listTracksMissingCover, updateTrackCover } from "./repo";
import { refreshAvatar } from "./avatars";
import { handleFriendInvite, registerFriendActions } from "./bot-friends";
import {
  beginBatch,
  endBatchByCommand,
  finishBatchByCommand,
  handleNameReply,
  reportBatchStatus,
  maybeOfferBatchHint,
  maybeSweepIdleSessions,
  refreshStatus,
  registerIngestActions,
} from "./ingest-session";
import { recordIngestFailure } from "./repo";
import {
  announceCrateOpened,
  crateForGroup,
  handleBotMembershipChange,
  isGroupChat,
  noteGroupDeparture,
  noteGroupJoins,
  noteGroupPresence,
} from "./bot-groups";

/**
 * Tracks scanned per /covers run, to stay inside Telegraf's 90s handlerTimeout.
 * (Telegram's own webhook timeout isn't the constraint: webhookReply is on by
 * default, so the handler's first reply is sent as the webhook response and
 * ends it long before the scan finishes.) Overrunning is survivable anyway —
 * each cover is committed as it's found and the scan only ever selects tracks
 * still missing one, so an interrupted run resumes on the next /covers.
 */
const COVER_BACKFILL_BATCH = 25;

export function createBot(): Telegraf | null {
  if (!config.botToken) {
    console.warn("[bot] BOT_TOKEN not set — bot disabled, API-only mode.");
    return null;
  }

  const bot = new Telegraf(config.botToken);

  const miniAppKeyboard = config.miniAppUrl
    ? {
        reply_markup: {
          inline_keyboard: [[{ text: "Open App", web_app: { url: config.miniAppUrl } }]],
        },
      }
    : undefined;

  // Telegram gives bots no way to ask who is in a group, so the membership list
  // is built out of whatever the bot happens to witness. Every update from a
  // group is evidence, so this runs ahead of all of it — and never blocks it.
  bot.use((ctx, next) => {
    noteGroupPresence(ctx);
    return next();
  });

  // Added to (or removed from) a group. Adding is where the crate is created
  // and the privacy disclosure is posted.
  bot.on("my_chat_member", async (ctx) => {
    try {
      await handleBotMembershipChange(bot, ctx.myChatMember);
    } catch (err) {
      console.error("[bot] group membership change failed:", err);
    }
  });

  bot.on(message("new_chat_members"), (ctx) => {
    noteGroupJoins(ctx.chat.id, ctx.message.new_chat_members);
  });

  bot.on(message("left_chat_member"), (ctx) => {
    noteGroupDeparture(ctx.chat.id, ctx.message.left_chat_member.id);
  });

  registerFriendActions(bot);
  registerIngestActions(bot);

  // Everything forwarded until the batch is closed goes to one destination.
  // The reply these send becomes the batch's status message: from here on the
  // bot edits that one message instead of answering each file.
  //
  // Private only: a batch is a conversation between one person and the bot, and
  // in a group every file already has a destination.
  bot.command("playlist", (ctx) => {
    if (!isPrivate(ctx)) return;
    return beginBatch(ctx, "playlist");
  });
  bot.command("album", (ctx) => {
    if (!isPrivate(ctx)) return;
    return beginBatch(ctx, "album");
  });

  // The way out. Named for where the files go rather than for the act of
  // stopping, because that is what the user is choosing.
  bot.command("unsorted", (ctx) => {
    if (!isPrivate(ctx)) return;
    return endBatchByCommand(bot, ctx.from.id, (text) => ctx.reply(text));
  });

  bot.command("done", (ctx) => {
    if (!isPrivate(ctx)) return;
    return finishBatchByCommand(bot, ctx);
  });

  bot.command("status", (ctx) => {
    if (!isPrivate(ctx)) return;
    return reportBatchStatus(ctx.from.id, (text) => ctx.reply(text));
  });

  bot.start(async (ctx) => {
    // /start in a group is somebody tapping a link, not asking for the welcome.
    if (!isPrivate(ctx)) return;

    // /start is the one moment the bot is certain to hear from this person, so
    // it is where the user row and their profile photo are brought up to date.
    // Neither is allowed to delay the reply or fail it.
    await ensureUser(ctx.from.id, ctx.from.username);
    void refreshAvatar(bot, ctx.from.id);

    // A friend deep link arrives as /start with a payload. It answers on its
    // own terms — someone tapping a friend's link came to add a friend, not to
    // read the welcome.
    const friendMatch = /^friend_(\d+)$/.exec(ctx.startPayload ?? "");
    if (friendMatch) {
      await handleFriendInvite(bot, ctx.from, Number(friendMatch[1]), (text) =>
        ctx.reply(text, miniAppKeyboard)
      );
      return;
    }

    // The welcome has one job: get a first track in. Everything else the bot
    // can do is discovered later, when the user is already holding a library.
    await ctx.reply(
      "This is Navaar — your music, kept in Telegram.\n\n" +
        "Forward me any audio file and it lands in your library. Nothing is uploaded " +
        "anywhere else: the file stays in Telegram and Navaar keeps the tags, the " +
        "artwork, and where you left off.\n\n" +
        "Sending a whole album? Send /album first and I'll keep them together.\n\n" +
        "Send a track to start, then open the app.\n\n" +
        "/playlist — turn the next batch you send into a playlist\n" +
        "/album — tag the next batch as one album\n" +
        "/done — finish the batch you're sending\n" +
        "/covers — fill in artwork for tracks that are missing it",
      miniAppKeyboard
    );
  });

  // Covers are captured at ingest, so this only matters for tracks added
  // before that existed — or ones whose artwork couldn't be read at the time.
  bot.command("covers", async (ctx) => {
    if (!isPrivate(ctx)) return;
    const ownerId = ctx.from.id;
    try {
      const missing = await listTracksMissingCover(ownerId);
      if (missing.length === 0) {
        await ctx.reply("Every track in your library already has cover art.");
        return;
      }

      const batch = missing.slice(0, COVER_BACKFILL_BATCH);
      await ctx.reply(`Looking for artwork on ${batch.length} track(s)…`);

      let found = 0;
      for (const track of batch) {
        const cover = await resolveCoverArt({ fileId: track.telegram_file_id });
        if (!cover) continue;
        await updateTrackCover(track.id, ownerId, cover.image, cover.mimeType);
        found++;
      }

      const remaining = missing.length - batch.length;
      await ctx.reply(
        `Added cover art to ${found} of ${batch.length} track(s).` +
          (found < batch.length
            ? " The rest have no artwork embedded in the file — you can set those in the Mini App."
            : "") +
          (remaining > 0 ? `\n\n${remaining} still to check — run /covers again.` : ""),
        miniAppKeyboard
      );
    } catch (err) {
      console.error("[bot] cover backfill failed:", err);
      await ctx.reply("Something went wrong looking for cover art. Please try again.");
    }
  });

  bot.on(message("audio"), async (ctx) => {
    const audio = ctx.message.audio;
    await handleIncomingAudio(bot, ctx, {
      fileId: audio.file_id,
      fileName: audio.file_name,
      mimeType: audio.mime_type,
      performer: audio.performer,
      title: audio.title,
      durationSeconds: audio.duration,
      fileSize: audio.file_size,
      thumbFileId: audio.thumbnail?.file_id,
    });
  });

  bot.on(message("document"), async (ctx) => {
    const doc = ctx.message.document;
    if (!doc.mime_type?.startsWith("audio/")) return;
    await handleIncomingAudio(bot, ctx, {
      fileId: doc.file_id,
      fileName: doc.file_name,
      mimeType: doc.mime_type,
      fileSize: doc.file_size,
      thumbFileId: doc.thumbnail?.file_id,
    });
  });

  async function handleIncomingAudio(
    botInstance: Telegraf,
    ctx: {
      chat?: { id: number; type: string; title?: string };
      from?: { id: number; username?: string };
      reply: (text: string, extra?: any) => Promise<unknown>;
    },
    audio: IncomingAudio
  ) {
    if (ctx.chat && isGroupChat(ctx.chat)) {
      await handleGroupAudio(botInstance, ctx, ctx.chat, audio);
      return;
    }

    const userId = ctx.from!.id;
    // Every message is a chance to notice a batch nobody came back to.
    maybeSweepIdleSessions(botInstance);

    const label = audio.title ?? audio.fileName ?? "track";

    try {
      const { session } = await ingestAudioMessage(
        userId,
        ctx.from?.username,
        audio
      );

      // Inside a batch the running status line is the only response. A reply
      // per file is exactly the noise the batch commands exist to remove.
      if (session) {
        refreshStatus(botInstance, session);
        return;
      }

      await ctx.reply(`Added "${label}" to your library.`, miniAppKeyboard);
      // Somebody forwarding a stack of files by hand is doing what /playlist
      // is for, and has no way to know it exists.
      await maybeOfferBatchHint(userId, (text) => ctx.reply(text));
    } catch (err) {
      const tooLarge = err instanceof AudioTooLargeError;
      if (!tooLarge) console.error("[bot] failed to ingest audio:", err);

      // A failure inside a batch is recorded rather than announced, so the
      // closing summary can name it. Nothing is quietly dropped either way.
      const session = await recordIngestFailureIfBatching(userId, label);
      if (session) {
        refreshStatus(botInstance, session);
        return;
      }

      await ctx.reply(
        tooLarge
          ? "That file is over Telegram's 20MB Bot API download limit, so I can't fetch it."
          : "Something went wrong saving that file. Please try again."
      );
    }
  }

  /**
   * A file posted in a group.
   *
   * Nothing is said on success. A bot answering every music post is exactly the
   * noise /playlist exists to remove in DMs, and a group is worse: it is
   * everyone's chat, not a conversation with the bot. The group was told what
   * happens to audio when the bot arrived, and the crate itself is the receipt.
   * The one exception is the first track, which is when the crate becomes worth
   * opening.
   */
  async function handleGroupAudio(
    botInstance: Telegraf,
    ctx: {
      from?: { id: number; username?: string };
      reply: (text: string, extra?: any) => Promise<unknown>;
    },
    chat: { id: number; type: string; title?: string },
    audio: IncomingAudio
  ) {
    // Absent on an automatic channel forward, which has no person to own the
    // track. Nothing to file, and nothing worth saying about it.
    const from = ctx.from;
    if (!from) return;
    const label = audio.title ?? audio.fileName ?? "track";

    try {
      const crate = await crateForGroup(botInstance, chat, from.id);
      const { position } = await ingestGroupAudioMessage(
        from.id,
        from.username,
        audio,
        crate.playlistId
      );

      // Skipped when the crate was created by this very file: the disclosure
      // that just went out already says where audio goes.
      if (position === 0 && !crate.created) {
        await announceCrateOpened(botInstance, chat);
      }
    } catch (err) {
      const tooLarge = err instanceof AudioTooLargeError;
      if (!tooLarge) console.error("[bot] failed to ingest group audio:", err);

      // Failures are the one thing worth interrupting a group for: silence here
      // would read as success, and the track would be quietly missing.
      await ctx.reply(
        tooLarge
          ? `Couldn't add "${label}" — it's over Telegram's 20MB Bot API download limit.`
          : `Couldn't add "${label}". Try posting it again.`
      );
    }
  }

  /** Records a failed file against the open batch, if there is one. */
  async function recordIngestFailureIfBatching(userId: number, label: string) {
    try {
      return await recordIngestFailure(userId, label);
    } catch (err) {
      console.error("[bot] could not record batch failure:", err);
      return null;
    }
  }

  // Registered after the commands so it only ever sees ordinary text. Its one
  // job is the force-reply that names a batch; anything else is left alone.
  bot.on(message("text"), async (ctx) => {
    // Group text is only ever membership evidence, already recorded above.
    if (!isPrivate(ctx)) return;

    const handled = await handleNameReply(
      bot,
      ctx.from.id,
      ctx.message.text,
      ctx.message.reply_to_message?.message_id,
      (text) => ctx.reply(text)
    );
    if (handled) return;

    maybeSweepIdleSessions(bot);
  });

  return bot;
}

/**
 * The command menu Telegram shows in the attachment bar.
 *
 * Published from here rather than typed into BotFather, so the menu cannot
 * drift away from the commands the bot actually answers. Groups get an empty
 * list: none of these mean anything there, and a menu full of commands that do
 * nothing is worse than no menu.
 */
export async function publishCommandList(bot: Telegraf): Promise<void> {
  try {
    await bot.telegram.setMyCommands(
      [
        { command: "playlist", description: "Put the next batch into one playlist" },
        { command: "album", description: "Tag the next batch as one album" },
        { command: "done", description: "Finish the batch you're sending" },
        { command: "status", description: "What the current batch has picked up" },
        { command: "unsorted", description: "End the batch — the rest go to your library" },
        { command: "covers", description: "Find artwork for tracks that are missing it" },
      ],
      { scope: { type: "all_private_chats" } }
    );
    await bot.telegram.setMyCommands([], { scope: { type: "all_group_chats" } });
  } catch (err) {
    console.error("[bot] could not publish the command list:", err);
  }
}

/** Whether an update came from a one-to-one chat with the bot. */
function isPrivate(ctx: { chat?: { type: string } }): boolean {
  return ctx.chat?.type === "private";
}
