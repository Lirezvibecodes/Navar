# Navaar

A music library that lives inside a Telegram Mini App. Forward audio files to
the bot; they land in your library, tagged and playable. From there you can
organise tracks into playlists and albums, follow friends and see what they're
playing, share tracks and playlists (in Telegram or out to a Story), and pick
up a small set of collectible profile tags along the way.

(The package and service names still say `telegram-music-player` — that was the
working title. See [NAVAAR.md](NAVAAR.md) and [PROJECT.md](PROJECT.md) for a
deeper architecture writeup; both predate several features below and should be
read as historical rather than authoritative.)

Runs entirely on free tiers:

- **Server**: Node.js + TypeScript (Telegraf bot + Express API) on [Render](https://render.com) free web service
- **Database**: [Supabase](https://supabase.com) free Postgres
- **Storage**: none — audio and cover art both stay on Telegram's own servers
  permanently. The server only stores each file's Telegram `file_id` and
  streams it on demand by proxying the Bot API's file server; a Postgres
  `BYTEA` column holds a cover only as a fallback for the rare case a channel
  post fails.
- **Frontend**: React + Vite + TypeScript + Tailwind, built by the server and
  served from the same origin — one domain, so no CORS and no second deploy

Repo layout:

```
/server   Telegraf bot + Express API
/web      React Mini App frontend
```

## What's in it

- **Ingest** — forward one file or a whole album; `/playlist` and `/album`
  turn the next batch you send into a playlist or a tagged album, with a
  single status message that edits itself as files land instead of a reply
  per track. `/covers` backfills artwork for tracks that are missing it.
  Group chats work too: add the bot to a group (with Group Privacy off) and
  it keeps a shared "crate" of whatever the group forwards.
- **Library** — your tracks, playlists and albums, plus a "Crate" of
  recently-ingested tracks you haven't sorted into a playlist yet, and a
  Favorites view built entirely from the heart on a track row (no separate
  table — it can't be renamed, shared, or added to by hand).
- **Player** — a full-screen player with synced lyrics (looked up from
  [LRCLIB](https://lrclib.net), best-effort — plays fine with none found) and
  album metadata/tracklists filled in from [MusicBrainz](https://musicbrainz.org)
  when available. Both lookups are unauthenticated and optional; a failure or
  a miss never blocks playback.
- **Search** — one search across your whole library: tracks, playlists,
  albums and artists together, not scoped to whichever screen you opened it
  from.
- **Social** — add friends by handle, by Telegram deep link, or from "people
  your friends know"; see a feed of what they've played, saved or shared;
  follow a friend's playlist; browse a friend's library directly.
- **Sharing** — share a track or a playlist as a message in Telegram (a
  deep link that opens straight to it in the app), or share a track out to a
  Telegram Story as a rendered lyric card.
- **Profile** — a handle, display name, avatar (pulled from your Telegram
  photo), an accent color, an optional custom background, a language
  (English/Farsi, switchable anytime from Settings), and listening stats.
- **Navaar Tags** — a small collectible layer of profile badges across five
  rarity tiers, unlocked by listening habits and library milestones (first
  track, a genre streak, a play-count threshold, and so on). Cosmetic only —
  they don't change what you can do in the app.

## How it works

1. You forward an audio file to your bot in a private chat (or send it in a
   group the bot has joined).
2. The bot records the message's `file_id` and whatever tags Telegram parsed
   (title/artist/duration) as a row in Postgres — the audio bytes themselves
   are never downloaded or copied anywhere; Telegram keeps hosting the file.
   Cover art gets the same treatment: posted once to a private "covers"
   channel the bot administers, with only the resulting `file_id` written
   down.
3. You open the Mini App (button in the bot's reply, or pinned in the chat).
   It authenticates using Telegram's `initData`, then lists your tracks.
4. You play tracks — the server re-resolves the `file_id` to a Telegram
   download URL via `getFile` and proxies the bytes through, with seeking via
   HTTP Range requests — organize them into playlists and albums, edit
   tags/cover art, and follow friends to see and hear what they're into.
   Edits only ever update the database row; the app never reads tags back out
   of the audio file, so nothing is rewritten into it.

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
   which is what group crates are built on.

## 4. Set up Supabase (Postgres)

1. Create a free account/project at [supabase.com](https://supabase.com).
2. In your project, go to **Project Settings → Database** and copy the
   **connection string** (URI format, "Connection pooling" variant is fine).
3. Paste it into `server/.env` as `DATABASE_URL`.
4. Run `npm run migrate` from `/server` to create the schema — see
   [Notes on the data model](#notes-on-the-data-model) below.

Supabase's free tier pauses a project after 7 days of no traffic; the first
request after a pause will be slow while it wakes up, but no action is needed
beyond that.

Also set `JWT_SECRET` in `server/.env` to any long random string (used to sign
session tokens issued after Telegram auth) — e.g. generate one with
`openssl rand -hex 32`.

Two more Telegram channels are needed in production, but nothing has to be
pasted into `.env` for them: make the bot an admin of any two channels of your
own, one with "cover" or "photo" somewhere in its title and one with "log" in
its title. The bot recognizes each by its title the first time it posts
there and remembers the channel id from then on — the covers channel is
where cover art actually lives (see step 4's note above), and the log
channel gets a caption for every track ever ingested, as a human-browsable,
re-downloadable mirror of the library that isn't a database. Both are
optional in the sense that nothing in the app breaks without them — cover art
falls back to storing bytes in Postgres, and the log channel simply isn't
written to — but the intended production setup has both.

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
2. Forward an audio file (or send one as a document) to the bot. Send
   `/playlist` or `/album` first if you're sending a batch you want kept
   together.
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
`deleted_at IS NULL`.

The schema has grown well past the original four tables via 27 migrations
(`server/migrations/*.up.sql`, the authoritative source). Broadly, by what
they're for:

- **Library**: `users`, `tracks`, `playlists`, `playlist_tracks`,
  `album_metadata` (MusicBrainz lookups, cached), `track_saves`.
- **Social**: `friendships`, `group_members`, `playlist_follows`,
  `listen_status`, `plays`.
- **Sharing**: `track_shares` (the tokens behind `/s/track/:token` links).
- **Navaar Tags**: `user_tags`, `user_equipped_tags`, `user_tag_stats`,
  `user_tag_track_stats`, `user_tag_listening_days`,
  `user_tag_listened_artists` — the aggregate counters `tagEvaluator.ts`
  checks after every play, save or friend acceptance to decide what unlocks.
- **Ingest**: `ingest_sessions` (the self-editing status message behind a
  forwarded batch), `app_channels` (the covers/log channel ids, once
  discovered — see step 4 above).

An earlier `endorsements` table (a peer-endorsement "Taste Tier" system) was
built, then dropped in migration 023 in favor of Navaar Tags — it's gone from
the current schema entirely.
