import { config } from "./config";
import { createBot } from "./bot";
import { createApp } from "./app";

async function main() {
  const bot = createBot();
  const app = createApp(bot);

  if (bot) {
    if (config.webhookUrl) {
      // Production (Render): webhook mode. A sleeping free web service can only be
      // woken by an incoming HTTP request, so long polling would silently stop
      // dispatching updates once the service sleeps — webhooks avoid that.
      const path = `/telegraf/${bot.secretPathComponent()}`;
      app.use(bot.webhookCallback(path));
      await bot.telegram.setWebhook(`${config.webhookUrl}${path}`);
      console.log(`[bot] webhook registered at ${path}`);
    } else {
      // Local dev: long polling, no public URL required.
      bot.launch();
      console.log("[bot] long polling started");
    }

    process.once("SIGINT", () => bot.stop("SIGINT"));
    process.once("SIGTERM", () => bot.stop("SIGTERM"));
  }

  app.listen(config.port, () => {
    console.log(`[server] listening on port ${config.port}`);
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
