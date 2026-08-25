import path from "path";
import express, { Express } from "express";
import type { Telegraf } from "telegraf";
import { authRouter } from "./routes/auth";
import { tracksRouter } from "./routes/tracks";
import { playlistsRouter } from "./routes/playlists";
import { albumsRouter, artistsRouter } from "./routes/collections";
import { usersRouter } from "./routes/users";
import { meRouter } from "./routes/me";
import { friendsRouter } from "./routes/friends";
import { socialRouter } from "./routes/social";
import { homeRouter } from "./routes/home";
import { sharedRouter } from "./routes/shared";

// The web app is built into this package (see the build script) and served
// from the same origin, so the Mini App only ever depends on this one domain
// instead of a separate static host. It lives inside server/ rather than being
// read from ../web/dist because Render only deploys the service's rootDir.
const webDist = path.join(__dirname, "../web-dist");

export function createApp(bot: Telegraf | null): Express {
  const app = express();

  // Render terminates TLS at its own proxy, so without this every request
  // arrives from the same address and req.ip is useless — which matters
  // because the share routes rate-limit by it, and one shared counter for the
  // whole internet would throttle everybody at once. One hop, not `true`: with
  // `true` Express believes the leftmost X-Forwarded-For entry, which the
  // client writes, and a limiter keyed on a value the caller chooses is not a
  // limiter. At 1 it reads the entry Render's proxy appended.
  app.set("trust proxy", 1);

  // Render captures stdout as the service's only log stream, so without this
  // there is no record of what actually reached the server — which makes it
  // impossible to tell a client that never connected from one that got an
  // error back. The user agent distinguishes Telegram's in-app WebView.
  //
  // Only the path is logged, never the query string: <audio> and <img> cannot
  // send an Authorization header, so the stream and cover URLs carry the
  // session JWT as ?token=. Logging originalUrl would print a valid seven-day
  // credential into the log stream on every seek.
  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on("finish", () => {
      const pathOnly = req.originalUrl.split("?")[0];
      console.log(
        `[http] ${req.method} ${pathOnly} ${res.statusCode} ${Date.now() - startedAt}ms ` +
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
  app.use("/api/albums", albumsRouter());
  app.use("/api/artists", artistsRouter());
  app.use("/api/users", usersRouter());
  app.use("/api/me", meRouter());
  app.use("/api/friends", friendsRouter());
  app.use("/api/social", socialRouter());
  app.use("/api/home", homeRouter());
  // Deliberately last, and deliberately without requireAuth: everything above
  // this line knows who is calling and nothing below it does.
  app.use("/api/shared", sharedRouter());

  // Vite content-hashes everything it emits into /assets, so a file at a given
  // name can never change its contents — a year and `immutable` are safe by
  // construction, and they are the difference between a cold open
  // re-downloading the whole bundle and re-downloading nothing.
  app.use(
    "/assets",
    express.static(path.join(webDist, "assets"), {
      maxAge: "1y",
      immutable: true,
    })
  );

  // The rest of the build — the fonts, the favicon, Telegram's own SDK — keeps
  // its filename across deploys, so it gets a day and then a revalidation that
  // usually answers 304. index.html is excluded outright: it is the file that
  // names the hashed bundles, so serving a stale one serves a stale app. It
  // may still be revalidated — no-cache forbids using a copy without asking,
  // not keeping one.
  app.use(
    express.static(webDist, {
      maxAge: "1d",
      setHeaders: (res, filePath) => {
        if (path.basename(filePath) === "index.html") {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    })
  );
  app.get(/^\/(?!api|health|telegraf).*/, (_req, res) => {
    // Same rule as above, for the deep links that fall through to the shell.
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(webDist, "index.html"));
  });

  // Catches errors forwarded by asyncHandler (e.g. database or Telegram API
  // failures) so one
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
