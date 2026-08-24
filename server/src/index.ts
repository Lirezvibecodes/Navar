import type { Express } from "express";
import type { Telegraf } from "telegraf";
import { config } from "./config";
import { createBot, publishCommandList } from "./bot";
import { createApp } from "./app";
import { setBotUsername } from "./bot-identity";

/**
 * Connects the bot to Telegram. Everything in here needs api.telegram.org to be
 * reachable, which is why it is one function the caller can fail on its own:
 * the Mini App, the API and the health check must keep serving when Telegram
 * does not answer.
 */
async function connectBot(bot: Telegraf, app: Express): Promise<void> {
  // Resolved once here rather than read from an env var, so friend deep links
  // cannot drift out of step with a rename in BotFather. Setting botInfo also
  // spares Telegraf the same call on its first update.
  bot.botInfo = await bot.telegram.getMe();
  setBotUsername(bot.botInfo.username);
  void publishCommandList(bot);

  if (config.webhookUrl) {
    // Production (Render): webhook mode. A sleeping free web service can only be
    // woken by an incoming HTTP request, so long polling would silently stop
    // dispatching updates once the service sleeps — webhooks avoid that.
    //
    // Mounted after the rest of the app, which is safe because the SPA fallback
    // in createApp excludes /telegraf by pattern rather than by ordering.
    const path = `/telegraf/${bot.secretPathComponent()}`;
    app.use(bot.webhookCallback(path));
    await bot.telegram.setWebhook(`${config.webhookUrl}${path}`);
    console.log(`[bot] webhook registered at ${path}`);
  } else {
    // Local dev: long polling, no public URL required. Not awaited (it
    // resolves only once polling stops); catch so a failed/interrupted
    // launch logs instead of crashing the whole process, API included.
    bot.launch().catch((err) => {
      console.error("[bot] long polling failed to start:", err);
    });
    console.log("[bot] long polling started");
  }

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
}

async function main() {
  const bot = createBot();
  const app = createApp(bot);

  // Listening first, and before Telegram is involved at all, so a slow or
  // unreachable Bot API delays the bot rather than the health check.
  app.listen(config.port, () => {
    console.log(`[server] listening on port ${config.port}`);
  });

  if (bot) {
    // A failure here leaves the bot disconnected until the next restart, which
    // on a free service that sleeps is usually minutes away. That is a worse
    // bot and a working app; exiting would be neither. Consumers of the bot
    // identity already treat it as optional, so deep links go unavailable
    // rather than wrong.
    await connectBot(bot, app).catch((err: unknown) => {
      console.error("[bot] could not connect to Telegram; API still serving:", err);
    });
  }
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
