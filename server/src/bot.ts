import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { config } from "./config";
import { ingestAudioMessage, AudioTooLargeError, IncomingAudio } from "./audio-ingest";

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
        "Once you've sent a few tracks, open the Mini App to browse, play, and edit them.",
      miniAppKeyboard
    );
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
