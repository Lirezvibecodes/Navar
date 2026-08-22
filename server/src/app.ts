import path from "path";
import express, { Express } from "express";
import type { Telegraf } from "telegraf";
import { authRouter } from "./routes/auth";
import { tracksRouter } from "./routes/tracks";
import { playlistsRouter } from "./routes/playlists";

// The web app is built into this package (see the build script) and served
// from the same origin, so the Mini App only ever depends on this one domain
// instead of a separate static host. It lives inside server/ rather than being
// read from ../web/dist because Render only deploys the service's rootDir.
const webDist = path.join(__dirname, "../web-dist");

export function createApp(bot: Telegraf | null): Express {
  const app = express();

  // Render captures stdout as the service's only log stream, so without this
  // there is no record of what actually reached the server — which makes it
  // impossible to tell a client that never connected from one that got an
  // error back. The user agent distinguishes Telegram's in-app WebView.
  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on("finish", () => {
      console.log(
        `[http] ${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - startedAt}ms ` +
          `ua="${req.get("user-agent") ?? "-"}"`
      );
    });
    next();
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true, botEnabled: bot !== null });
  });

  // Scoped to /api so the Telegraf webhook route (mounted separately, outside
  // /api) still gets its raw, unconsumed request body to parse updates from.
  app.use("/api", express.json());

  app.use("/api/auth", authRouter());
  app.use("/api/tracks", tracksRouter());
  app.use("/api/playlists", playlistsRouter());

  app.use(express.static(webDist));
  app.get(/^\/(?!api|health|telegraf).*/, (_req, res) => {
    res.sendFile(path.join(webDist, "index.html"));
  });

  // Catches errors forwarded by asyncHandler (e.g. DB/R2 failures) so one
  // request's failure returns a 500 instead of crashing the whole process.
  app.use(
    (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      console.error("[api] unhandled error:", err);
      if (res.headersSent) return;
      res.status(500).json({ error: "Internal server error" });
    }
  );

  return app;
}
