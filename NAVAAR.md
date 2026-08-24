# Navaar

**Navaar** is a personal, Spotify-style music library that lives entirely inside a
Telegram Mini App. You forward audio files to a Telegram bot; the bot indexes them,
and a React web app — opened from inside Telegram — lets you browse, play, tag, and
organize them into playlists.

The defining architectural idea is that **Navaar stores no audio files**. Telegram
already hosts every file you send it, permanently and for free. Navaar records only
the Telegram `file_id` and re-resolves it to a download URL on demand, proxying the
bytes through to the browser. The entire system therefore runs on free tiers with no
object storage bill and no upload/egress costs.

---

## Table of contents

1. [What it does](#1-what-it-does)
2. [Architecture at a glance](#2-architecture-at-a-glance)
3. [Repository layout](#3-repository-layout)
4. [The backend](#4-the-backend-server)
5. [The database](#5-the-database)
6. [Authentication and security model](#6-authentication-and-security-model)
7. [Audio streaming](#7-audio-streaming)
8. [The frontend](#8-the-frontend-web)
9. [API reference](#9-api-reference)
10. [Configuration](#10-configuration)
11. [Deployment](#11-deployment)
12. [Local development](#12-local-development)
13. [Design decisions and their history](#13-design-decisions-and-their-history)
14. [Known limits and constraints](#14-known-limits-and-constraints)

---

## 1. What it does

The complete user journey:

1. **Ingest.** You open a private chat with the Navaar bot and forward it an audio
   file (or send one as a document with an `audio/*` MIME type). The bot reads the
   metadata Telegram already parsed — title, performer, duration, MIME type — and
   writes a database row pointing at Telegram's copy of the file. The audio bytes
   are never downloaded, copied, or re-uploaded anywhere.
2. **Open.** The bot replies with an inline **"Open Music Player"** button that
   launches the Mini App inside Telegram's WebView.
3. **Authenticate.** The Mini App reads Telegram's signed `initData` blob, posts it
   to the server, and receives a JWT session token in exchange.
4. **Browse and play.** The app lists your tracks. Tapping one streams it: the
   server resolves the stored `file_id` to a fresh Telegram download URL and pipes
   the bytes through, forwarding HTTP `Range` headers so seeking works.
5. **Organize.** You can edit a track's title, artist, and album; upload cover art;
   create playlists; and add or remove tracks from them.

Tag edits only ever touch the database row. Navaar never rewrites the audio file
itself — the file on Telegram's servers is left byte-for-byte untouched.

---

## 2. Architecture at a glance

```
┌──────────────┐   forwards audio    ┌──────────────────────────────────┐
│   Telegram   │ ──────────────────► │  Navaar server (Render, free)    │
│    client    │                     │                                  │
│              │ ◄────────────────── │  ┌────────────┐  ┌────────────┐  │
│  ┌────────┐  │   webhook replies   │  │ Telegraf   │  │  Express   │  │
│  │Mini App│  │                     │  │    bot     │  │    API     │  │
│  │(WebView)│ │   HTTPS /api/*      │  └─────┬──────┘  └─────┬──────┘  │
│  └────────┘  │ ◄─────────────────► │        └───────┬───────┘         │
└──────────────┘                     │           repo.ts (pg)           │
       ▲                             │                │                 │
       │  serves the built           │      static web-dist/ (React)    │
       │  React bundle               └────────────────┼─────────────────┘
       └────────────────────────────────────          │
                                                      ▼
   audio bytes proxied from            ┌──────────────────────────┐
   api.telegram.org/file/...           │  Supabase Postgres (free)│
                                       │  users, tracks,          │
                                       │  playlists, playlist_    │
                                       │  tracks (+ cover BYTEA)  │
                                       └──────────────────────────┘
```

**Stack:**

| Layer     | Technology                                                    |
| --------- | ------------------------------------------------------------- |
| Bot       | Telegraf 4 (webhook in production, long polling locally)       |
| API       | Express 4 + TypeScript, compiled with `tsc` to CommonJS        |
| Database  | Postgres via `pg` (Supabase free tier)                         |
| Auth      | Telegram `initData` HMAC validation → JWT (`jsonwebtoken`)     |
| Frontend  | React 19 + Vite 8 + TypeScript + Tailwind CSS 4                |
| Hosting   | Render free web service (single origin serves API *and* app)   |
| Storage   | None for audio — Telegram hosts it. Covers live in Postgres.   |

A key structural point: **the API and the Mini App are served from the same origin.**
The server's build script builds the React app into `server/web-dist/` and Express
serves it statically. That means one domain, no CORS, and no separate static host.

---

## 3. Repository layout

```
/
├── render.yaml                 Render Blueprint (service definition + env vars)
├── README.md                   Setup walkthrough
├── NAVAAR.md                   This document
│
├── server/                     Telegraf bot + Express API + static host
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example
│   ├── migrations/             Numbered SQL migrations (up/down pairs)
│   │   ├── 001_init.up.sql
│   │   ├── 001_init.down.sql
│   │   ├── 002_telegram_storage.up.sql
│   │   └── 002_telegram_storage.down.sql
│   ├── src/
│   │   ├── index.ts            Entry point: wires bot + app, chooses webhook/polling
│   │   ├── app.ts              Express app: logging, routes, static, error handler
│   │   ├── bot.ts              Telegraf handlers (/start, audio, document)
│   │   ├── audio-ingest.ts     Shared ingest logic + size guard
│   │   ├── config.ts           Env var loading (optional/required helpers)
│   │   ├── db.ts               Lazy Postgres connection pool
│   │   ├── repo.ts             All SQL — the only module that touches the DB
│   │   ├── types.ts            Track and Playlist row shapes
│   │   ├── jwt.ts              Session token sign/verify
│   │   ├── middleware.ts       requireAuth
│   │   ├── telegram-auth.ts    initData HMAC validation
│   │   ├── telegram-files.ts   file_id → download URL via Bot API getFile
│   │   ├── asyncHandler.ts     Async route error forwarding
│   │   ├── migrate.ts          Migration runner
│   │   └── routes/
│   │       ├── auth.ts
│   │       ├── tracks.ts
│   │       └── playlists.ts
│   ├── dist/                   Compiled JS (build output)
│   └── web-dist/               Copy of web/dist (build output, served statically)
│
└── web/                        React Mini App
    ├── package.json
    ├── vite.config.ts
    ├── wrangler.toml           Legacy Cloudflare Pages config
    ├── index.html              Loads the Telegram SDK as a classic script
    ├── scripts/
    │   └── copy-telegram-sdk.mjs   Copies the SDK into public/ pre-build
    ├── public/                 favicon, icons, telegram-web-app.js
    └── src/
        ├── main.tsx            React root
        ├── App.tsx             All app state and view routing
        ├── api.ts              Typed fetch wrapper + session token storage
        ├── telegram.ts         window.Telegram.WebApp accessor
        ├── types.ts            Track / Playlist (mirrors server types.ts)
        ├── view.ts             View union type
        ├── index.css           Tailwind theme tokens
        ├── context/
        │   └── PlayerContext.tsx   Audio element, queue, playback state
        └── components/
            ├── Nav.tsx             Sidebar (desktop) + BottomNav (mobile)
            ├── TrackList.tsx
            ├── TrackRow.tsx
            ├── NowPlayingBar.tsx
            ├── PlaylistsView.tsx
            ├── PlaylistDetailView.tsx
            └── TrackEditModal.tsx
```

---

## 4. The backend (`server/`)

### Startup (`src/index.ts`)

`main()` creates the bot, creates the Express app, then picks a bot transport:

- **`WEBHOOK_URL` set (production):** mounts Telegraf's webhook callback at a secret
  path (`/telegraf/<secretPathComponent()>`) and registers it with Telegram. This is
  required on Render's free tier — a sleeping service can only be woken by an
  incoming HTTP request, so long polling would silently stop receiving updates once
  the instance idled out.
- **`WEBHOOK_URL` empty (local dev):** calls `bot.launch()` for long polling. The
  promise is deliberately *not* awaited (it only resolves when polling stops) and is
  `.catch()`-ed so a failed launch logs instead of taking the API down with it.

`SIGINT`/`SIGTERM` handlers stop the bot cleanly. A top-level `.catch()` logs fatal
startup errors and exits with code 1.

### The Express app (`src/app.ts`)

Middleware order matters here and is deliberate:

1. **Request logger.** Logs method, URL, status, duration, and user agent for every
   request. Render's only log stream is stdout, so without this there is no way to
   distinguish a client that never connected from one that got an error back. The
   user agent is included specifically because it identifies Telegram's in-app
   WebView.
2. **`GET /health`** — returns `{ ok: true, botEnabled: <bool> }`. Render's health
   check path.
3. **`express.json()` scoped to `/api`** — deliberately *not* global, so the Telegraf
   webhook route (mounted outside `/api` in `index.ts`) still receives its raw,
   unconsumed body to parse updates from.
4. **API routers** at `/api/auth`, `/api/tracks`, `/api/playlists`.
5. **`express.static(webDist)`** — serves the built React bundle.
6. **SPA fallback** — `GET /^\/(?!api|health|telegraf).*/` returns `index.html` so
   client-side routes resolve.
7. **Error handler** — catches anything forwarded by `asyncHandler`, logs it, and
   returns a 500 rather than crashing the process.

### The bot (`src/bot.ts`)

`createBot()` returns `null` if `BOT_TOKEN` is unset, which puts the server in a
usable API-only mode instead of failing to boot.

Handlers:

- **`/start`** — welcome message plus the "Open Music Player" inline keyboard button
  (only attached if `MINI_APP_URL` is configured).
- **`message("audio")`** — Telegram already parsed the ID3 tags; forwards `file_id`,
  `file_name`, `mime_type`, `performer`, `title`, `duration`, `file_size` to ingest.
- **`message("document")`** — same path, but only for documents whose MIME type
  starts with `audio/`. Non-audio documents are silently ignored.

Both funnel into a shared `handleIncomingAudio` that catches `AudioTooLargeError` and
replies with a specific, actionable message, versus a generic failure reply for
anything else.

### Ingest (`src/audio-ingest.ts`)

`ingestAudioMessage()` is the single ingest path. It:

1. Upserts the sender into `users`.
2. Rejects files over 20 MB up front when Telegram reported a `file_size`.
3. Calls `bot.telegram.getFile(fileId)` as a reachability probe — this both confirms
   the file is actually fetchable and catches the "too big" case for files where
   Telegram did *not* report a size up front. A `"too big"` substring in the error
   message is translated into `AudioTooLargeError`.
4. Derives a fallback title from the filename with the extension stripped, if
   Telegram gave no `title`.
5. Inserts the track row with a client-generated `randomUUID()`.

### Data access (`src/repo.ts`)

Every SQL statement in the project lives in this one module — routes never write
queries themselves. Two patterns run throughout:

**Ownership is enforced in SQL, not in application code.** Every query carries
`owner_telegram_id = $n` in its `WHERE` clause, sourced from the verified JWT. A
request for someone else's track ID simply returns zero rows, which the routes turn
into a 404. There is no separate "is this yours?" check that could be forgotten.

The one multi-table case, `addPlaylistTrack`, verifies *both* the playlist and the
track belong to the caller in a single query before inserting — it never trusts the
IDs in the request body.

**Cover bytes are never fetched incidentally.** A shared `TRACK_COLUMNS` constant
selects `(cover_image IS NOT NULL) AS has_cover` instead of `cover_image` itself, so
list, get, and update calls return a boolean rather than pulling image blobs over the
wire. Only the dedicated `getTrackCover()` query reads the actual bytes.

### Migrations (`src/migrate.ts`)

A minimal forward-only runner. It creates a `schema_migrations` table, reads
`migrations/*.up.sql` in sorted order, skips already-applied files, and applies each
remaining one inside a transaction — committing the migration and its
`schema_migrations` row together, rolling back both on failure. Run with
`npm run migrate`.

---

## 5. The database

Four tables, all scoped by `owner_telegram_id`. There is no shared or global library.

```sql
users
  telegram_user_id  BIGINT PRIMARY KEY
  username          TEXT
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()

tracks
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid()
  owner_telegram_id BIGINT NOT NULL REFERENCES users ON DELETE CASCADE
  title             TEXT
  artist            TEXT
  album             TEXT
  duration_seconds  INTEGER
  telegram_file_id  TEXT NOT NULL      -- the whole storage strategy, in one column
  mime_type         TEXT
  cover_image       BYTEA              -- cover art stored inline
  cover_mime_type   TEXT
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
  INDEX idx_tracks_owner (owner_telegram_id)

playlists
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid()
  owner_telegram_id BIGINT NOT NULL REFERENCES users ON DELETE CASCADE
  name              TEXT NOT NULL
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
  INDEX idx_playlists_owner (owner_telegram_id)

playlist_tracks
  playlist_id       UUID NOT NULL REFERENCES playlists ON DELETE CASCADE
  track_id          UUID NOT NULL REFERENCES tracks ON DELETE CASCADE
  position          INTEGER NOT NULL
  PRIMARY KEY (playlist_id, track_id)
  INDEX idx_playlist_tracks_playlist_position (playlist_id, position)
```

Notes:

- The `pgcrypto` extension provides `gen_random_uuid()`.
- `ON DELETE CASCADE` throughout means deleting a user removes their entire library.
- `playlist_tracks` has a composite primary key, so adding a track twice is a no-op
  (`ON CONFLICT DO NOTHING`). New tracks get `MAX(position) + 1`.
- **Migration 002 is the interesting one.** It dropped `r2_audio_key` and
  `r2_cover_key` and added `telegram_file_id`, `mime_type`, `cover_image`, and
  `cover_mime_type` — the moment the project abandoned Cloudflare R2 object storage
  in favor of Telegram-as-storage.

---

## 6. Authentication and security model

### Step 1 — Telegram `initData` validation (`src/telegram-auth.ts`)

When the Mini App opens, Telegram's WebView exposes `window.Telegram.WebApp.initData`
— a URL-encoded, HMAC-signed blob containing the user's identity. `validateInitData()`
implements Telegram's documented verification algorithm exactly:

1. Parse the query string, extract and remove the `hash` field.
2. Build the data-check string: remaining `key=value` pairs sorted alphabetically,
   joined with `\n`.
3. Derive the secret key as `HMAC-SHA256("WebAppData", BOT_TOKEN)`.
4. Compute `HMAC-SHA256(secretKey, dataCheckString)` and compare it to the provided
   hash using **`timingSafeEqual`** (constant-time — not `===`).
5. Reject if `auth_date` is missing, non-numeric, or older than 24 hours.
6. Parse the `user` JSON and require a numeric `id`.

Any failure returns `null`, which the route turns into a 401.

### Step 2 — JWT session (`src/jwt.ts`, `src/middleware.ts`)

On successful validation, `POST /api/auth/telegram` upserts the user and signs a
7-day JWT whose `sub` is the Telegram user ID. The client stores it in
`localStorage` and sends it as `Authorization: Bearer <token>`.

`requireAuth` accepts the token from **either** the `Authorization` header **or** a
`?token=` query parameter. The query-param path exists because native `<audio>` and
`<img>` elements cannot set request headers, and the stream and cover routes are
consumed exactly that way. On success it attaches `telegramUserId` to the request.

### The trust boundary

| Trusted                        | Not trusted                                  |
| ------------------------------ | -------------------------------------------- |
| `req.telegramUserId` from JWT  | Any ID in a URL path or request body         |
| Telegram's HMAC over initData  | `initData` contents before verification      |

Every repo function takes `ownerTelegramId` from the verified token and puts it in the
`WHERE` clause. Path parameters like `:id` are used only as *additional* filters,
never as authorization.

### Other hardening present

- Cover uploads are capped at 5 MB by Multer and buffered in memory (never written
  to disk).
- Audio ingest is capped at Telegram's 20 MB Bot API limit.
- The Telegraf webhook lives at a secret, token-derived path.
- Postgres connections use SSL with `rejectUnauthorized: false` for hosted databases
  (Supabase's cert chain), and plain connections for `localhost`.
- `asyncHandler` guarantees a rejected promise reaches the error middleware rather
  than killing the Node process.

---

## 7. Audio streaming

This is the mechanism that makes the whole zero-storage design work.

```
Browser <audio src=".../stream?token=…">
   │
   │ GET /api/tracks/:id/stream    (Range: bytes=1048576-)
   ▼
requireAuth → verify JWT → telegramUserId
   │
   ▼
getTrack(id, ownerTelegramId)  ──►  404 if not the caller's row
   │
   ▼
getTelegramFileDownloadUrl(track.telegram_file_id)
   │   GET api.telegram.org/bot<TOKEN>/getFile?file_id=…
   │   → { result: { file_path: "music/file_42.mp3" } }
   ▼
fetch("api.telegram.org/file/bot<TOKEN>/music/file_42.mp3",
      { headers: { Range: <forwarded> } })
   │
   ▼
Copy Content-Length / Content-Range, set Accept-Ranges: bytes,
status 206 if ranged, then pipe the Web ReadableStream → Express response
```

Key properties:

- **`file_id` → URL resolution happens per request.** Telegram's download URLs are
  time-limited, so caching them would break; only the stable `file_id` is stored.
- **Range requests are forwarded verbatim**, and the upstream `Content-Range` is
  copied back with a `206`. That is what makes the seek bar work.
- **The response is streamed, not buffered.** `Readable.fromWeb(upstream.body).pipe(res)`
  means the server never holds a whole track in memory.
- **The bot token never reaches the browser.** It is embedded in the upstream URL,
  which only the server ever sees.
- An upstream failure returns a `502` rather than a generic 500, distinguishing
  "Telegram wouldn't give us the file" from "our code broke".

Cover art takes a much simpler path — the bytes live in Postgres, so
`GET /api/tracks/:id/cover` reads the `BYTEA` column and sends it with the stored
MIME type (defaulting to `image/jpeg`).

---

## 8. The frontend (`web/`)

### Structure

`App.tsx` holds **all** application state — there is no router and no state library.
Navigation is a discriminated union:

```ts
type View =
  | { type: "library" }
  | { type: "playlists" }
  | { type: "playlist"; id: string };
```

State lives in `useState`: `tracks`, `playlists`, `playlistTracks`, `editingTrack`,
plus `ready` and `authError` gates. Mutations update the server first, then patch
local state optimistically-after-the-fact (e.g. `setPlaylists(prev => …)`), avoiding
a full refetch.

### Boot sequence

```
mount → getTelegramWebApp()?.ready() and .expand()
      → if initData exists: POST /api/auth/telegram → store JWT
      → Promise.all([listTracks(), listPlaylists()])
      → setReady(true)
```

Outside Telegram there is no `window.Telegram.WebApp`, so `initData` is absent and
authentication is skipped entirely. The app still renders — useful for UI work, but
API calls will 401 without a valid session.

### Playback (`context/PlayerContext.tsx`)

A single `<audio>` element is rendered by `PlayerProvider` and shared through
context. It exposes `currentTrack`, `queue`, `isPlaying`, `progress`, `duration`,
and the actions `play`, `togglePlay`, `next`, `prev`, `seek`.

- `play(track, queue)` sets the queue and current track, then assigns `audio.src`
  inside a `requestAnimationFrame` so the element is mounted before the source is
  set.
- `next`/`prev` share a `stepQueue(direction)` helper that wraps around the queue
  modularly, so the queue loops in both directions.
- `onEnded` is wired directly to `next`, giving automatic advance.
- Playing any row calls `play(track, tracks)` — the visible list *becomes* the queue,
  so playing from a playlist queues that playlist.

### API client (`src/api.ts`)

A thin typed `fetch` wrapper. It attaches the bearer token, sets JSON content type
(but leaves `FormData` alone so the browser can set the multipart boundary), unwraps
error bodies into thrown `Error`s, and returns `undefined` for `204` responses.

`trackStreamUrl()` and `trackCoverUrl()` build URLs with `?token=` appended, because
`<audio>` and `<img>` cannot carry an `Authorization` header.

`API_BASE` comes from `VITE_API_BASE_URL` and defaults to `""` — meaning same-origin,
which is the production configuration on Render.

### Components

| Component            | Responsibility                                                     |
| -------------------- | ------------------------------------------------------------------ |
| `Sidebar`            | Desktop nav (`md:flex`), lists Library, Playlists, and each playlist |
| `BottomNav`          | Mobile nav (`md:hidden`), two tabs                                  |
| `TrackList`          | Renders rows, wires each one's play action to queue the whole list  |
| `TrackRow`           | Cover, title, artist, duration, and a `⋯` menu (edit / add to playlist / remove) |
| `NowPlayingBar`      | Cover, metadata, transport controls, seek slider                    |
| `TrackEditModal`     | Title/artist/album fields plus cover upload with local preview      |
| `PlaylistsView`      | Playlist grid and creation                                          |
| `PlaylistDetailView` | One playlist's tracks, rename, delete                               |

### Styling

Tailwind CSS 4 with a small custom theme defined in `index.css` via `@theme` — a
dark Spotify-like palette (`--color-app-bg: #0d0d0d`, `--color-app-accent: #1db954`,
etc.) exposed as utility classes such as `bg-app-surface` and `text-app-text-muted`.
Responsive behavior is a straightforward sidebar-on-desktop, bottom-nav-on-mobile
split at the `md` breakpoint.

### The Telegram SDK loading quirk

`web/index.html` loads `/telegram-web-app.js` as a plain classic `<script>` from
Navaar's own origin, and `scripts/copy-telegram-sdk.mjs` copies that file out of
`node_modules/@twa-dev/sdk/` into `public/` on every `predev` and `prebuild`.

This is unusual, and both halves of it were forced by real failures:

- **Why not load it from `telegram.org`?** That domain is blocked on some networks
  where the Mini App itself still loads fine. Because the script tag is
  render-blocking, the WebView stalls on it and reports "load failed".
- **Why not just `import` it?** `@twa-dev/sdk` maps its `import` condition to a
  CommonJS file, so Vite resolves the default export to an interop wrapper instead
  of the `WebApp` object. The wrapper is truthy, so the `window.Telegram` fallback
  never triggered and `webApp?.ready()` threw before React could mount — a blank
  page.

Loading it as a classic script sidesteps the bundler's CJS/ESM interop entirely and
is how Telegram documents it anyway.

---

## 9. API reference

All `/api/tracks` and `/api/playlists` routes require authentication. All of them are
implicitly scoped to the authenticated user; a resource belonging to someone else
returns `404`, never `403`.

### Auth

| Method | Path                  | Body                  | Response          |
| ------ | --------------------- | --------------------- | ----------------- |
| `POST` | `/api/auth/telegram`  | `{ initData: string }` | `{ token: string }` |

`400` if `initData` is missing, `401` if the HMAC or `auth_date` check fails.

### Tracks

| Method | Path                      | Notes                                                    |
| ------ | ------------------------- | -------------------------------------------------------- |
| `GET`  | `/api/tracks`             | All the caller's tracks, newest first. No cover bytes.    |
| `GET`  | `/api/tracks/:id/stream`  | Proxied audio. Honors `Range`, returns `206` when ranged. |
| `GET`  | `/api/tracks/:id/cover`   | Cover image bytes. `404` if none set.                     |
| `PATCH`| `/api/tracks/:id`         | `{ title?, artist?, album? }`. `COALESCE` — omitted fields keep their value. |
| `POST` | `/api/tracks/:id/cover`   | `multipart/form-data`, field `cover`, max 5 MB.           |

Tracks are created by the bot, not the API — there is no `POST /api/tracks`.

### Playlists

| Method   | Path                                | Notes                             |
| -------- | ----------------------------------- | --------------------------------- |
| `GET`    | `/api/playlists`                    | Newest first                      |
| `POST`   | `/api/playlists`                    | `{ name }` → `201`                |
| `PATCH`  | `/api/playlists/:id`                | `{ name }`                        |
| `DELETE` | `/api/playlists/:id`                | `204`                             |
| `GET`    | `/api/playlists/:id/tracks`         | Ordered by `position`             |
| `POST`   | `/api/playlists/:id/tracks`         | `{ trackId }` → `204`; appends at the end |
| `DELETE` | `/api/playlists/:id/tracks/:trackId`| `204`                             |

### System

| Method | Path      | Response                              |
| ------ | --------- | ------------------------------------- |
| `GET`  | `/health` | `{ ok: true, botEnabled: boolean }`   |

---

## 10. Configuration

### Server (`server/.env`)

| Variable       | Required | Purpose                                                        |
| -------------- | -------- | -------------------------------------------------------------- |
| `PORT`         | No       | Listen port. Defaults to `3000`; Render uses `10000`.           |
| `BOT_TOKEN`    | Yes*     | From BotFather. Without it the bot is disabled (API-only mode). |
| `MINI_APP_URL` | No       | URL behind the "Open Music Player" button.                      |
| `WEBHOOK_URL`  | Prod only| Public base URL. Set → webhook mode; empty → long polling.       |
| `DATABASE_URL` | Yes*     | Postgres connection string (Supabase pooled URI is fine).        |
| `JWT_SECRET`   | Yes*     | Session signing key. Generate with `openssl rand -hex 32`.      |

\* Not required to *boot* — `config.ts` reads everything as optional and the
`required()` helper throws lazily, on the specific route that needs the value. This
is what lets the server start in a degraded but inspectable state.

### Web (`web/.env`)

| Variable            | Purpose                                                     |
| ------------------- | ----------------------------------------------------------- |
| `VITE_API_BASE_URL` | API origin. Leave empty for same-origin (the Render setup).  |

---

## 11. Deployment

Navaar deploys as **one Render web service** that serves both the API and the Mini
App. `render.yaml` is a Blueprint:

```yaml
services:
  - type: web
    name: telegram-music-player-server
    runtime: node
    plan: free
    rootDir: server
    buildCommand: npm install && npm run build
    startCommand: npm run start
    healthCheckPath: /health
    envVars:
      - key: NODE_VERSION   # 24.19.0 — Vite 8 / plugin-react / oxlint need >=22.12
        value: 24.19.0
      - key: PORT
        value: 10000
      - key: BOT_TOKEN      # sync: false — set in the dashboard
      # … MINI_APP_URL, WEBHOOK_URL, DATABASE_URL, JWT_SECRET
```

The server's build script does the cross-package work:

```jsonc
"build": "tsc -p tsconfig.json                       // compile server → dist/
        && npm --prefix ../web install               // install web deps
        && npm --prefix ../web run build             // build the React bundle
        && node -e \"cpSync('../web/dist','web-dist',{recursive:true})\""
```

Building the web bundle *into* `server/web-dist` is deliberate: Render only deploys
the service's `rootDir`, so anything at `../web/dist` is absent at runtime. Copying
it inside `server/` keeps it within `rootDir`.

**Setup order** (details in [README.md](README.md)):

1. Create the bot with @BotFather → get `BOT_TOKEN`.
2. Create a Supabase project → get `DATABASE_URL`, then run `npm run migrate`.
3. Deploy to Render from `render.yaml`, filling in the `sync: false` env vars.
4. Set `WEBHOOK_URL` to the Render service URL (no trailing slash).
5. Register that same URL as the Mini App URL in BotFather, and as `MINI_APP_URL`.
6. Verify `https://<service>.onrender.com/health` returns `ok`.

`web/wrangler.toml` is a leftover from an earlier Cloudflare Pages deployment. It is
no longer part of the active deployment path, which is now single-origin on Render.

---

## 12. Local development

**Prerequisites:** Node.js 22.12+ (24.x recommended, matching Render).

```bash
cd server
cp .env.example .env      # fill in BOT_TOKEN, DATABASE_URL, JWT_SECRET
npm install
npm run migrate
npm run dev               # tsx watch → http://localhost:3000
```

```bash
cd web
cp .env.example .env      # VITE_API_BASE_URL=http://localhost:3000
npm install
npm run dev               # vite → http://localhost:5173
```

With `WEBHOOK_URL` empty the bot uses long polling, so no public URL or tunnel is
needed for the bot half.

The Mini App half is different: outside a real Telegram client there is no
`window.Telegram.WebApp`, so `initData` is empty, authentication is skipped, and you
will see the UI but no data. To exercise the full flow, either point BotFather's Mini
App URL at a deployed build, or tunnel the dev server (`ngrok http 5173`) and
register the tunnel URL.

**Scripts:**

| Location | Command            | Effect                                     |
| -------- | ------------------ | ------------------------------------------ |
| `server` | `npm run dev`      | `tsx watch src/index.ts`                   |
| `server` | `npm run build`    | Compile server + build and copy web bundle |
| `server` | `npm run start`    | `node dist/index.js`                       |
| `server` | `npm run typecheck`| `tsc --noEmit`                             |
| `server` | `npm run migrate`  | Apply pending migrations                   |
| `web`    | `npm run dev`      | Vite dev server (port 5173)                |
| `web`    | `npm run build`    | `tsc -b && vite build`                     |
| `web`    | `npm run lint`     | `oxlint`                                   |

---

## 13. Design decisions and their history

The git history records several deliberate reversals worth understanding, because
each one removed a moving part.

### Telegram as the storage layer (migration 002)

The original schema had `r2_audio_key` and `r2_cover_key` — Cloudflare R2 object
storage. That was replaced entirely: Telegram already hosts every file forwarded to
a bot, permanently and free, so Navaar stores only the `file_id` and re-resolves it
per request. This eliminated an entire cloud dependency, its credentials, its egress
costs, and the upload step during ingest. Cover art — small enough not to matter —
moved into a Postgres `BYTEA` column rather than requiring object storage of its own.

### Single origin instead of a split frontend/backend

The frontend was originally deployed separately to Cloudflare Pages (hence
`wrangler.toml` and `VITE_API_BASE_URL`). It now builds into `server/web-dist` and is
served by Express from the same origin as the API. One domain, no CORS
configuration, no second deployment to keep in sync, and one fewer URL to register
with BotFather.

The first attempt at this served `../web/dist` and returned 500s on Render with
`ENOENT`, because `rootDir: server` means only that directory reaches the runtime
instance. Building the output *inside* `server/` fixed it.

### Webhook mode in production, polling locally

Render's free tier sleeps a service after 15 minutes of inactivity, and only an
inbound HTTP request wakes it. Long polling is an *outbound* connection, so a sleeping
service would silently stop receiving updates forever. Webhooks make Telegram's
delivery itself the wake-up call. Locally, polling avoids needing a public URL at all.

### The Telegram SDK saga (three commits)

Covered in [§8](#the-telegram-sdk-loading-quirk). Short version: `telegram.org` →
bundled import → self-hosted classic script, driven by a network-blocking issue and
then a CJS/ESM interop bug that produced a blank page.

### Request logging

Added because Render's only log stream is stdout, making an unlogged request
indistinguishable from one that never arrived — which made it impossible to tell
whether Telegram's WebView was reaching the server at all when a Mini App failed to
load.

### Lazy configuration

`config.ts` reads every variable as optional; `required()` throws only when a value
is actually needed. The result is that a misconfigured deployment still boots, still
serves `/health`, and still logs — so you can diagnose it — rather than
crash-looping.

---

## 14. Known limits and constraints

| Limit | Cause | Effect |
| ----- | ----- | ------ |
| **20 MB per audio file** | Telegram Bot API download cap | Larger files are rejected at ingest with an explanatory reply. Lifting this would require a self-hosted Bot API server, which the project intentionally does not do. |
| **5 MB per cover image** | Multer configuration | Upload fails above this. |
| **~30–60 s cold start** | Render free tier sleeps after 15 min idle | First request after idle is slow. |
| **Supabase pauses after 7 days idle** | Supabase free tier | First request after a pause is slow while the DB wakes. No action needed. |
| **Every stream costs a `getFile` call** | Telegram URLs are time-limited | Adds a round trip per playback start; the URL cannot be cached. |
| **Streams pass through the server** | Bot token must not reach the browser | All audio bandwidth flows through Render rather than direct-to-CDN. |
| **7-day sessions** | JWT expiry | Reopening the Mini App silently re-authenticates from `initData`. |
| **No track deletion** | Not implemented | Tracks can be removed from playlists but not from the library. |
| **No playlist reordering** | `position` is append-only | Tracks land at the end; there is no move/reorder endpoint. |
| **No search** | Not implemented | The library is a flat, chronological list. |
| **No tests** | None in the repo | `npm run typecheck` and `npm run lint` are the only automated checks. |
