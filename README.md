# Navaar

A music library that lives inside a Telegram Mini App. Forward audio files to
the bot; they land in your library, tagged and playable, and you can organise
them into playlists, edit their tags and artwork, and share playlists with
friends.

(The package and service names still say `telegram-music-player` — that was the
working title.)

Runs entirely on free tiers:

- **Server**: Node.js + TypeScript (Telegraf bot + Express API) on [Render](https://render.com) free web service
- **Database**: [Supabase](https://supabase.com) free Postgres
- **Storage**: none — audio stays on Telegram's own servers permanently; the
  server only stores each file's Telegram `file_id` and streams it on demand
  by proxying the Bot API's file server. Cover art (small images) is stored
  as bytes directly in Postgres.
- **Frontend**: React + Vite + TypeScript + Tailwind, built by the server and
  served from the same origin — one domain, so no CORS and no second deploy

Repo layout:

```
/server   Telegraf bot + Express API
/web      React Mini App frontend
```

## How it works

1. You forward an audio file to your bot in a private chat.
2. The bot records the message's `file_id` and whatever tags Telegram parsed
   (title/artist/duration) as a row in Postgres — the audio bytes themselves
   are never downloaded or copied anywhere; Telegram keeps hosting the file.
3. You open the Mini App (button in the bot's reply, or pinned in the chat).
   It authenticates using Telegram's `initData`, then lists your tracks.
4. You play tracks — the server re-resolves the `file_id` to a Telegram
   download URL via `getFile` and proxies the bytes through, with seeking via
   HTTP Range requests — organize them into playlists, and edit tags/cover
   art. Edits only ever update the database row; the app never reads tags
   back out of the audio file, so nothing is rewritten into it.

Note: the standard Bot API caps file downloads at 20MB. Larger files can't be
ingested without running a self-hosted Bot API server, which this project
intentionally does not do.

---

## 1. Local development

### Prerequisites

- Node.js 22+
- A Supabase project (see step 4) if you want the bot/API to actually work
  locally — otherwise the server will start in a degraded mode (missing env
  vars throw on the routes that need them).

### Server

```bash
cd server
cp .env.example .env
# fill in .env with real values (see steps 2 and 4 below)
npm install
npm run migrate   # applies migrations/*.sql to your Postgres database
npm run dev
```

This starts the API on `http://localhost:3000` (health check at `/health`).
With `BOT_TOKEN` set and `WEBHOOK_URL` left empty, the bot runs in long-polling
mode locally — no public URL needed.

### Web

```bash
cd web
cp .env.example .env
# set VITE_API_BASE_URL=http://localhost:3000
npm install
npm run dev
```

This starts the Vite dev server on `http://localhost:5173`. Outside of an
actual Telegram client, `window.Telegram.WebApp` won't exist, so
`initData` will be empty and authentication will be skipped — useful for UI
work, but you won't see real data without a valid session. To test the full
flow, use Telegram's Mini App preview (see step 3) pointed at a deployed
build, or a tunnel (e.g. `ngrok http 5173`) registered as the Mini App URL.

---

## 2. Create your bot (BotFather)

1. Open a chat with [@BotFather](https://t.me/BotFather) in Telegram.
2. Send `/newbot` and follow the prompts to choose a name and username.
3. BotFather gives you a **bot token** — copy it into `server/.env` as
   `BOT_TOKEN`. Keep this secret; anyone with it can control your bot.

## 3. Register the Mini App URL

Come back to this once the server is deployed (step 5) — the Mini App is served
by the server, so the two share a URL.

1. In BotFather, send `/mybots`, choose your bot, then **Bot Settings → Menu
   Button** (or **Configure Mini App** depending on BotFather's current menu).
2. Set the Mini App URL to your Render service URL, e.g.
   `https://telegram-music-player-server.onrender.com`.
3. Set the same URL as `MINI_APP_URL` in the server's environment — it builds
   the "Open App" button the bot sends after ingesting a track.
4. While you are in BotFather: under **Bot Settings → Group Privacy**, turn
   privacy **off**. Without that the bot cannot see audio posted in a group,
   which is what group playlists are built on.

## 4. Set up Supabase (Postgres)

1. Create a free account/project at [supabase.com](https://supabase.com).
2. In your project, go to **Project Settings → Database** and copy the
   **connection string** (URI format, "Connection pooling" variant is fine).
3. Paste it into `server/.env` as `DATABASE_URL`.
4. Run `npm run migrate` from `/server` to create the schema
   (`users`, `tracks`, `playlists`, `playlist_tracks`).

Supabase's free tier pauses a project after 7 days of no traffic; the first
request after a pause will be slow while it wakes up, but no action is needed
beyond that.

Also set `JWT_SECRET` in `server/.env` to any long random string (used to sign
session tokens issued after Telegram auth) — e.g. generate one with
`openssl rand -hex 32`.

## 5. Deploy the server (Render)

1. Push this repo to GitHub.
2. Create a free account at [render.com](https://render.com) and connect your
   GitHub repo.
3. Render will detect `render.yaml` at the repo root and offer to create the
   `telegram-music-player-server` web service from it (Blueprint deploy). If
   it doesn't auto-detect, create a new **Web Service** manually with:
   - Root directory: `server`
   - Build command: `npm install && npm run build`
   - Start command: `npm run start`
   - Health check path: `/health`
4. In the service's **Environment** tab, fill in the env vars left blank by
   `render.yaml` (`BOT_TOKEN`, `MINI_APP_URL`, `DATABASE_URL`, `JWT_SECRET`)
   with the same values from your local `server/.env`.
5. Also set `WEBHOOK_URL` to your Render service's public URL, e.g.
   `https://telegram-music-player-server.onrender.com` (no trailing slash).
   This switches the bot from long polling to webhook mode, which is required
   in production — Render's free tier sleeps the service after 15 minutes of
   inactivity, and only an incoming HTTP request (i.e. a webhook delivery) can
   wake it back up.
6. Deploy. Check `https://<your-service>.onrender.com/health` returns `ok`,
   and that the same URL in a browser serves the Mini App shell. The build
   command installs and builds `web/` and copies the output into
   `server/web-dist`, which Express serves — there is no separate frontend
   deploy, and therefore no CORS configuration anywhere.

Render's free tier will sleep after 15 minutes idle; the next Telegram message
or Mini App request will wake it, with a delay of up to ~30-60 seconds on that
first request.

## 6. Point BotFather at it

Go back to step 3 and register the Render URL as the Mini App URL, and as
`MINI_APP_URL` in Render's environment. Redeploy the server after changing it.

## 7. Try it

1. Open a chat with your bot in Telegram and send `/start`.
2. Forward an audio file (or send one as a document) to the bot.
3. Tap the "Open App" button in the bot's reply.
4. Your track should appear in the library. Tap it to play, use the "⋯" menu
   to edit tags/cover art or add it to a playlist.

---

## Notes on the data model

Every row is owned by exactly one person via `owner_telegram_id`, and that
ownership is enforced in SQL rather than in route handlers — every mutation
query carries the owner in its `WHERE` clause.

Reads are a separate question from ownership. A track you do not own is
readable if it sits in a playlist somebody has deliberately shared with you,
and that decision is one `EXISTS` query, not a chain of checks in application
code. Anything you are not allowed to see returns 404 rather than 403: a
resource you cannot see does not exist as far as the API is concerned.

Deleting a track is soft — the row keeps a `deleted_at` stamp for thirty days
so the undo affordance has something to restore — so every read path filters
`deleted_at IS NULL`. See `server/migrations/*.up.sql` for the full schema.
