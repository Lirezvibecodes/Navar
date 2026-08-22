import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { config } from "./config";
import { ingestAudioMessage, AudioTooLargeError, IncomingAudio } from "./audio-ingest";
import { resolveCoverArt } from "./cover-art";
import { listTracksMissingCover, updateTrackCover } from "./repo";

/**
 * Tracks scanned per /covers run. Bounded so the handler answers well inside
 * Telegram's webhook timeout instead of being retried mid-scan.
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
          inline_keyboard: [
            [{ text: "Open Music Player", web_app: { url: config.miniAppUrl } }],
          ],
        },
      }
    : undefined;

  bot.start((ctx) => {
    ctx.reply(
      "Welcome! Forward me audio files from any chat and I'll add them to your library.\n\n" +
        "Once you've sent a few tracks, open the Mini App to browse, play, and edit them.\n\n" +
        "/covers — fill in artwork for tracks that are missing it.",
      miniAppKeyboard
    );
  });

  // Covers are captured at ingest, so this only matters for tracks added
  // before that existed — or ones whose artwork couldn't be read at the time.
  bot.command("covers", async (ctx) => {
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
      from?: { id: number; username?: string };
      reply: (text: string, extra?: any) => Promise<unknown>;
    },
    audio: IncomingAudio
  ) {
    try {
      await ingestAudioMessage(
        botInstance,
        ctx.from!.id,
        ctx.from?.username,
        audio
      );
      await ctx.reply(
        `Added "${audio.title ?? audio.fileName ?? "track"}" to your library.`,
        miniAppKeyboard
      );
    } catch (err) {
      if (err instanceof AudioTooLargeError) {
        await ctx.reply(
          "That file is over Telegram's 20MB Bot API download limit, so I can't fetch it."
        );
        return;
      }
      console.error("[bot] failed to ingest audio:", err);
      await ctx.reply("Something went wrong saving that file. Please try again.");
    }
  }

  return bot;
}
