# Navaar — Implementation Roadmap

**For:** Claude Code, working in the Navaar repo
**Inputs:** this file, `NAVAAR.md` (architecture), the brand & UX handoff, the design files
**Order:** backend features and fixes first, then the frontend against the design files

---

## 0. Read this before starting

### What this document is

Several build prompts have been written for Navaar over time — sharing/social, navigation, context menu, batch ingest, and an early feature list. **They were written independently and they conflict.** They assign overlapping migration numbers, they duplicate work, and one of them specifies a feature that has since been cut.

This roadmap is the reconciliation. **Where this file disagrees with an earlier prompt, this file wins.** Where it's silent, the earlier prompt stands.

### The app is English-only

The early features prompt specified a bilingual English/Farsi onboarding flow. **That is cut.** Do not build:

- ❌ `users.language_code` column
- ❌ The language-selection inline keyboard on `/start`
- ❌ The `/language` command
- ❌ Farsi copy anywhere — bot messages, UI strings, placeholder names
- ❌ Returning `language_code` from `POST /api/auth/telegram`
- ❌ Persian/Arabic text normalisation in search (yeh/kaf folding, ZWNJ stripping)
- ❌ RTL layout, logical-property mirroring, Jalaali dates

`/start` sends the English welcome message directly. Search normalisation is case-folding and diacritic-stripping only.

**Don't add an i18n framework "for later."** Ship plain strings. Retrofitting i18n onto a small React app is a mechanical afternoon; carrying an unused abstraction through every component for months is not.

### Conventions — non-negotiable

These come from the existing codebase. Follow them exactly.

| Rule | Detail |
|---|---|
| SQL lives in `repo.ts` | Routes never write queries. No exceptions. |
| Migrations are numbered pairs | `NNN_name.up.sql` + `NNN_name.down.sql`, forward-only runner |
| `TRACK_COLUMNS` | Never select `cover_image` bytes incidentally. New columns get added to the shared list. |
| 404, never 403 | A resource the caller can't see does not exist. Never leak existence through the status code. |
| Ownership is enforced in SQL | Every mutation query carries `owner_telegram_id` in the `WHERE`. |
| One ingest path | Everything flows through `audio-ingest.ts`. Don't fork it. |
| Bot transport is env-driven | `WEBHOOK_URL` set → webhook; empty → polling. Don't change this. |

### Migration numbers — assigned here to prevent collisions

The earlier prompts each said "add a new numbered migration" and would have collided. Use exactly these:

| # | Name | Contents |
|---|---|---|
| **003** | `provenance_and_deletes` | `tracks.origin_adder_id`, `tracks.deleted_at`, backfills |
| **004** | `sharing` | friendships, playlist visibility/slug/group_chat_id, `playlist_tracks.added_by_telegram_id`, group_members, track_saves, endorsements, listen_status, plays |
| **005** | `avatars_and_ingest` | `users.avatar_file_id`, ingest_sessions |

Three migrations, grouped by phase rather than by feature, so each phase is one deploy and one rollback.

### Free-tier ceilings — design every query against these

- **Render sleeps at ~15 min idle**, cold start 30–60s. Minimise request *count* on any landing view.
- **Supabase free is 500 MB.** `plays` is the only unbounded table; it gets a prune.
- **No background timers or cron.** A sleeping instance doesn't run them. Everything expires lazily, evaluated on the next request.
- **Never poll from the client** in the background or while a tab is closed.

---

## 1. How this is prioritised

Not by feature value. By four things, in order:

1. **Security first.** There's a live token leak. It's a ten-minute fix and it goes before everything.
2. **Data you can't recover later, second.** `origin_adder_id` is set at ingest. Every day it isn't shipped, more tracks arrive with provenance that can only ever be guessed at afterwards. This is the only task in the roadmap with a real deadline.
3. **The authorization seam, third.** Splitting ownership from visibility gates roughly 60% of the remaining work and is the one place a mistake is a data breach rather than a bug.
4. **Everything else by dependency**, cheapest-unblocking-most first.

### One recommendation about sequencing

The instruction is backend-then-frontend, and the phases below respect that. But **Phase 4 (the frontend shell) is deliberately placed in the middle rather than at the end.** Building six phases of backend with no UI means nothing is verifiable until the very end, and the social endpoints in particular are near-impossible to sanity-check with curl alone.

Ship the shell as soon as the foundations land. Everything after it becomes visible as it's built.

---

## Phase 0 — Fixes and unrecoverable data
*Small, high-leverage, no dependencies. Do all of it before starting features.*

### P0-1 · Stop logging session tokens 🔴 **Security**

`app.ts`'s request logger writes `req.originalUrl`. Stream and cover URLs carry `?token=<JWT>`, so **every playback request prints a valid 7-day session token into Render's log stream.**

Log the path with the query string stripped. Nothing of value is lost — the path already identifies the route.

**Done when:** no query string appears in any log line; playback still works.

---

### P0-2 · `tracks.origin_adder_id` — migration 003 ⏳ **Time-sensitive**

Who first brought a file into Navaar. Free to capture at ingest, permanently unrecoverable afterwards.

```sql
ALTER TABLE tracks ADD COLUMN origin_adder_id BIGINT REFERENCES users ON DELETE SET NULL;
UPDATE tracks SET origin_adder_id = owner_telegram_id WHERE origin_adder_id IS NULL;
```

- Set it in `audio-ingest.ts` to the sender.
- Add to `TRACK_COLUMNS`.
- `ON DELETE SET NULL` so a departed user's contributions degrade to unknown rather than cascading their tracks away.
- **On the save-copy path (P4-2), inherit the source's value — do not set it to the immediate source's owner.** A→B→C all credit A. This is the whole point of the column; crediting the immediate source is already handled separately by `track_saves`.

**No UI for this yet.** Groundwork only.

**Done when:** new ingests carry it, all existing rows are backfilled, it rides along in `TRACK_COLUMNS`.

---

### P0-3 · Cache resolved Telegram file URLs

`getFile` is called on every stream request with no caching, so every seek pays an extra round trip to Telegram. Resolved URLs live ~1 hour.

In-memory `Map` keyed by `file_id`, TTL ~50 minutes, cleared on process restart. No persistence needed — a cold instance simply re-resolves.

**Done when:** repeated seeks on one track produce one `getFile` call, not one per seek.

---

### P0-4 · Track deletion — migration 003 + endpoint

There is currently no way to remove a track from a library. Build it as **soft delete with an undo window**, not a hard delete behind a confirmation dialog.

```sql
ALTER TABLE tracks ADD COLUMN deleted_at TIMESTAMPTZ;
```

- `DELETE /api/tracks/:id` sets `deleted_at = now()`, owner-scoped, returns 204.
- `POST /api/tracks/:id/restore` clears it, owner-scoped, valid within the window.
- **Every read path filters `deleted_at IS NULL`** — add it to the shared query fragment so it can't be forgotten on a new query.
- Hard-delete sweep: rows older than 30 days, run lazily on ingest, not on a timer.

**Done when:** a deleted track disappears from every list and stream path, restore works, and no read path leaks a deleted row.

---

### P0-5 · Fix tag clearing

`updateTrackTags` uses `COALESCE($n, column)`, so `undefined` leaves a field alone — but the edit modal always sends all three fields, so clearing an input writes `''` rather than `NULL`.

Distinguish "not provided" from "explicitly cleared": treat an empty string as an intentional `NULL`.

**Done when:** clearing the artist field in the edit modal actually clears it.

---

### P0-6 · Repo hygiene

Low priority, do them while you're in the files:

- Delete `web/wrangler.toml` — Cloudflare Pages is no longer used
- Remove the unused `playlists` prop from `BottomNav`
- Delete `web/public/icons.svg` (unreferenced template scaffolding)
- Replace `web/README.md` (untouched Vite template)
- Update the root `README.md` — its step 6 still describes a Cloudflare Pages frontend, which no longer works since there are no CORS headers
- Strip the stale R2 comment in `app.ts`

---

## Phase 1 — The authorization seam
*Gates most of what follows. Get it right; don't rush it.*

### P1-1 · Migration 004 — the full sharing schema

All of it in one migration: `friendships`, `playlists.visibility` / `share_slug` / `group_chat_id`, `playlist_tracks.added_by_telegram_id`, `group_members`, `track_saves`, `endorsements`, `listen_status`, `plays`.

**Every default is the closed one.** `visibility` defaults to `'private'`, `is_public` defaults to `false`. Applying this migration must change nobody's exposure.

Write the matching `.down.sql` that drops it all cleanly.

---

### P1-2 · `repo.ts` — the visibility layer 🔴 **Security-critical**

Today ownership *is* authorization. That becomes two concepts:

- **Ownership** — who can edit. Unchanged: `owner_telegram_id`.
- **Visibility** — who can see and play. New.

**Do not loosen the existing owner-scoped functions.** Keep `getTrack(id, ownerTelegramId)` exactly as it is for every mutation path, and add **separately-named** read functions for the visibility path.

```
getTrack(id, ownerId)              → mutations only, unchanged
getTrackForListener(id, requester) → reads only, new
```

Two functions with different names is much harder to misuse than one function with a boolean flag. A boolean gets passed the wrong way once and it's a data breach.

`getTrackForListener` returns the track if **any** of:
1. The requester owns it, or
2. It sits in a playlist owned by an accepted friend, with visibility `friends` or `public`, or
3. It sits in a playlist with visibility `public`, or
4. It sits in a group playlist whose `group_chat_id` the requester is a member of

**Express this as one SQL query with `EXISTS` subqueries**, not as sequential queries in application code.

`areFriends(a, b)` checks **both directions** with `status = 'accepted'`. Write the logic once, reuse it inline in every visibility query.

**Done when:** there are tests covering all four visibility paths plus the negative case, and no mutation route can reach a listener-scoped lookup.

---

### P1-3 · Swap the read routes

- `GET /api/tracks/:id/stream` → `getTrackForListener`
- `GET /api/tracks/:id/cover` → `getTrackForListener`
- `PATCH /api/tracks/:id` → **stays** on `getTrack`
- `POST /api/tracks/:id/cover` → **stays** on `getTrack`

The streaming mechanism itself doesn't change at all — `getTelegramFileDownloadUrl` → proxy with `Range` forwarding works identically regardless of who's asking, because the bot token is the only credential Telegram sees. **Only the authorization lookup above it changes.**

---

## Phase 2 — Backend foundations the frontend needs
*Everything the shell and the Library tab depend on.*

### P2-1 · Avatars — migration 005 + proxy route

```sql
ALTER TABLE users ADD COLUMN avatar_file_id TEXT;
```

- Fetch via `getUserProfilePhotos` on `/start`, store the `file_id`. Refresh opportunistically there, not per request.
- `GET /api/users/:id/avatar` proxies exactly like the existing cover route: `file_id` → `getFile` → pipe.
- **Many users hide their profile photo. That is the normal path, not an error** — return 404 cleanly and let the client draw its deterministic fallback (design handoff §5.3).

---

### P2-2 · `GET /api/tracks?filter=all|unsorted`

Extend the existing tracks route; don't add a parallel one. `unsorted` is a `NOT EXISTS` subquery against `playlist_tracks` — no new column, no denormalised flag.

---

### P2-3 · Credit on the tracks list

The tracks list must return, per row, who the caller got the track from — username and user ID — sourced from `track_saves`.

**One join, no N+1**, and it must not disturb the `TRACK_COLUMNS` rule about cover bytes.

**Withhold the name if the caller can't see that person** (not a friend, no shared group). Return the row without a credit rather than a username the caller has no relationship with.

---

### P2-4 · Derived Artists and Albums

`GROUP BY artist` / `GROUP BY album` over the caller's tracks, with a count and a representative cover. No new tables.

**Skip null rows rather than bucketing them** — no "Unknown Artist" entry. Telegram's parsed tags are patchy enough that it would be the largest entry for most users.

Plus: `PATCH /api/albums/:name` renaming across every one of the caller's tracks with that exact album value, owner-scoped. Needed because batch ingest (P3-2) can name fifteen tracks from one file's tags.

---

### P2-5 · Bulk track operations

For selection mode in The Crate:

- `POST /api/playlists/:id/tracks/bulk` — `{ trackIds[] }`, appends, skips duplicates silently
- `DELETE /api/tracks/bulk` — `{ trackIds[] }`, soft-deletes, owner-scoped, returns the count

Both owner-scoped, both single queries.

---

## Phase 3 — Bot-side
*Independent of the frontend. Can run in parallel with Phase 2.*

### P3-1 · Friend deep links

- `GET /api/me/invite-link` → `https://t.me/<BOT_USERNAME>?start=friend_<myTelegramId>`
- Extend `/start` to read `ctx.startPayload`. On `friend_<id>`: upsert the sender, create a `pending` friendship, message **both** parties — the addressee gets accept/decline inline buttons.
- Handle the callback: accept → `status = 'accepted'`; decline → delete the row.
- Guard: self-invite, duplicate/reverse pending (if B invites A while A→B is pending, just accept it), and a payload naming a nonexistent user.

**Username lookup is a fallback, not the primary path.** Telegram usernames are optional, changeable, and not resolvable via the Bot API — `users.username` only holds what was captured when that person last interacted. `POST /api/friends/by-username` resolves against the local table only and returns a clear "they need to start the bot first" when there's no match.

Endpoints: `GET /api/friends`, `GET /api/friends/pending`, `POST /api/friends/:id/accept`, `DELETE /api/friends/:id` (covers decline, cancel, and unfriend — all the same row deletion).

---

### P3-2 · Batch ingest modes — migration 005

`ingest_sessions` keyed by user, one active session each. **State lives in Postgres, not memory** — the free instance restarts and would silently lose everyone's mode mid-batch.

Modes: `/playlist` creates a playlist and attaches each arriving file; `/album` sets `tracks.album` on every file in the batch (**no playlist row**); `/unsorted` deletes the session. No `'unsorted'` mode row exists — unsorted is the absence of a session.

**Five design changes from the original prompt.** These matter; see the UX handoff §6.1 for the reasoning:

1. **Name at the end, not the beginning.** Don't create `New Playlist — <date>` and hope the user renames it, because they won't. The summary message carries a `[ Name it ]` button using force-reply. `/playlist Summer Drive` accepts a name inline for people who plan ahead. The placeholder becomes a fallback, not the default outcome.
2. **One message, not two.** The mode confirmation *becomes* the running status, edited in place via `editMessageText` (debounced to ~1 edit per 2s), with the `Done` button attached throughout. Two messages means the Done button scrolls away the moment files start landing.
3. **The summary reconciles.** Rejected files don't increment the count, so 20 forwarded files produce a summary of 14 with six missing and no way to tell which. **Name the failed files in the summary.**
4. **Announce expiry.** On lazy eviction of a stale session, send the summary *first*, then tell the user plainly: `That batch closed after 10 minutes idle — this one went to Unsorted.` Never let a mode end silently.
5. **Contextual discovery.** When 5+ files arrive in quick succession with no active session, offer once: `Looks like a batch. Want these as a playlist?` Cap at once per day. Nobody types `/playlist` unprompted.

Other rules: read the session **inside the track-insert transaction** (concurrent forwards race otherwise); resolve the album name from the *first* file's tag and apply it to all so one mistagged file can't split the batch; delete empty placeholder playlists on close; expire lazily on the next update, never on a timer; register `/playlist`, `/album`, `/unsorted`, `/done`, `/status` with BotFather.

---

### P3-3 · Group playlists

- Bot added to a group → create the playlist (`group_chat_id` set, `visibility = 'friends'`), post the **privacy disclosure** in the group.
- Audio in a group → existing `ingestAudioMessage` path creates a track owned by the sender, adds it to the group playlist with `added_by_telegram_id`, upserts the sender into `group_members`.
- Populate `group_members` opportunistically — `new_chat_members`, `left_chat_member` (delete), and any message from a user in that group. Bots can't enumerate members, so it builds up as people participate.
- **No backfill.** Bots can't read messages sent before they joined. State this in the group welcome message.

**The disclosure is not optional and not fine print.** Group Privacy must be disabled in BotFather for this to work, which means the bot sees *every* message in the group. Say so, in the group, in plain language, at the moment the bot joins. Exact copy in the UX handoff §5.22.

---

### P3-4 · Welcome message

English only. Include the `Open App` web_app button, and add a line about batch ingest: `Sending a whole album? Send /album first and I'll keep them together.`

---

## Phase 4 — Frontend shell ⬅ **Build this here, not at the end**
*Everything after this becomes visible as it's built.*

### P4-1 · Platform wiring — do this first, it's where the traps are

| Item | Detail |
|---|---|
| `disableVerticalSwipes()` on mount | **Blocking.** Without it, dragging the scrubber or reordering the queue closes the app. |
| Safe areas | Use Telegram's `safeAreaInset` / `contentSafeAreaInset`. **CSS `env(safe-area-inset-*)` resolves to zero inside the iOS Mini App WebView** — a layout built on it looks perfect in a browser and clips on a real iPhone. |
| `setHeaderColor` / `setBackgroundColor` | Navaar is dark-only and owns its palette. Match Telegram's chrome to it. |
| Native `BackButton` | Use it. No in-app back chevrons. |
| `MainButton` | Primary action in sheets. |
| `HapticFeedback` | Transport, toggles, save, queue actions. |
| `enableClosingConfirmation()` | On while audio is playing, off when paused. |
| `isActive` / activate-deactivate events | Record resume position. **Do not build a background-playback toggle** — we can't promise it. |
| `viewportStableHeight` | Layout, so the Now Playing bar doesn't jump when the keyboard opens. |

---

### P4-2 · The shell

- `TopBar` — own avatar (leading) → own profile; hamburger (trailing) → drawer. **No title text, no search field.**
- Drawer — Settings, Support/About. **Not Profile**; the avatar 40px away already goes there.
- Three-entry `Sidebar` (`md+`) / `BottomNav` (mobile): Home · Library · Social.
- **The stacking rule.** NowPlayingBar sits above BottomNav; every scrollable view needs bottom padding equal to both plus the safe-area inset, and the padding changes when the Now Playing bar first appears. Get this wrong and the last row of every list in the app is permanently unreachable.
- **Feedback layer** — one toast/snackbar component. One at a time, new replaces current, **except an undo snackbar is never replaced by an informational toast.** In selection mode it sits above the contextual action bar.

```ts
type View =
  | { type: "home" }
  | { type: "library" }
  | { type: "crate"; filter: "all" | "unsorted" }
  | { type: "playlist"; id: string }
  | { type: "artist"; name: string }
  | { type: "album"; name: string }
  | { type: "social" }
  | { type: "profile"; userId: number }
  | { type: "friendLibrary"; friendId: number }
  | { type: "shared"; slug: string };
```

Extend the existing union in `App.tsx`. **Don't introduce a router.** One profile view serves both your own profile and other people's — toggle edit affordances on `userId === me`.

---

### P4-3 · Library, The Crate, track row

- The Crate always first, full-width, **visually not a playlist card** — it can't be renamed, deleted, shared, or reordered, and if it looks like a playlist users will try all four.
- All / Unsorted segmented control.
- Selection mode in The Crate only: enter via `Select` or long-press, checkboxes, live count in the header, contextual action bar replacing the Now Playing bar, `Add to playlist` + `Remove`.
- Library search: client-side filter, incremental, no submit, matched substring highlighted.
- Track row: 64px fixed, generated pixel cover for coverless tracks, ownership-aware `⋯` menu in canonical order, 14px credit avatar on the metadata line.
- Remove-with-undo — row leaves immediately, snackbar with `Undo`, **no confirmation dialog.**

---

### P4-4 · Player

- **Segmented control: `Player · Lyrics · Queue`.** Not swipe panes — the scrubber is a horizontal drag and would race the pane gesture.
- Degradation ladder for short viewports: cover shrinks first (320→200), then reels inline, then icons tighten, then reels drop. **Transport and scrubber never scale.** Test at 550px of content height.
- Queue: three sections — Now playing, **Next in queue** (explicitly added), **Next from: —** (the context list).
- `queueNext` inserts **after the currently playing track**, not at index 0. If nothing is playing, both queue actions start playback instead of filling an inert queue.
- Queue actions need feedback — haptic + toast + a pulse on the Queue segment. Nothing on screen changes otherwise.
- Reorder: long-press to lift, **plus `Move up` / `Move down` / `Move to top` in the `⋯` menu.** Drag-only fails an accessibility requirement.
- Media Session API for metadata and lock-screen controls. Resume last track *and position* on relaunch.
- Sleep timer, lyrics (LRC karaoke / plain / none) per the design files.

---

## Phase 5 — Social
*Backend and frontend together now that the shell exists.*

### P5-1 · Playlist visibility and sharing

- `PATCH /api/playlists/:id` accepts `visibility`. Transition **to** `friends`/`public` generates a fresh `share_slug` (16+ chars, `crypto.randomBytes`, URL-safe). Transition **to** `private` nulls it.
- `POST /api/playlists/:id/rotate-slug` — regenerating is the only way to revoke a link someone already has, so it exists as its own explicit action.
- `GET /api/playlists/:id/tracks` switches to the listener-scoped read.

**Public links: the slug is the credential.** Anyone with the URL can stream forever, with no Telegram account, through the free instance.

- `GET /api/shared/:slug` and `/tracks` — unauthenticated, metadata only
- `GET /api/shared/:slug/tracks/:trackId/stream` and `/cover` — unauthenticated, **but the query must confirm the track sits in that slug's playlist.** Never accept a bare `trackId` on an unauthenticated route.
- Rate-limit `/api/shared/*` (in-memory counter keyed by IP is fine at this scale)
- **Label it "Anyone with the link," never "Public."** Make `friends` the recommended default in the picker.

---

### P5-2 · Save to my library

```
POST /api/tracks/:id/save
```
1. Resolve via `getTrackForListener` (404 if invisible)
2. Insert a **new** tracks row owned by the requester, copying `telegram_file_id`, title, artist, album, duration, mime, cover bytes, **and inheriting `origin_adder_id`**
3. Insert a `track_saves` row (saver, origin = source owner, new track id)
4. Return the new track

Because a track is metadata plus a file reference, this is a pure row copy — **no file transfer, no re-upload, no extra storage.** Guard against saving the same source twice.

The copy is deliberately independent: the saver can retag freely, and it keeps working if the original owner deletes theirs.

---

### P5-3 · Now playing, history, feeds

- `PATCH /api/me/listening-status`, `POST /api/me/plays` (debounced client-side so a seek doesn't spam rows), `PATCH /api/me/privacy`
- `GET /api/friends/listening` — accepted friends, `is_public = true`, `updated_at` within ~10 min. **Anyone outside that returns nothing at all — not a "hidden" placeholder.**
- `GET /api/me/recently-played` — last 50
- `GET /api/social/activity` — friends listening + playlists recently shared + tracks recently saved. Cap ~30. **The only endpoint refetched on an interval, only while the Social tab is open, max once per 30s.**
- **Prune `plays` older than 90 days** inside the logging function. It's the only unbounded table against a 500 MB ceiling — a few lines now versus a migration under pressure later.

**Activity rows must not name a stranger.** `@sara saved — from @ali` renders Ali's username to everyone Sara is friends with. Render the second name **only if the viewer can already see that person**; otherwise the row stops at `@sara saved —`.

---

### P5-4 · Discovery, profiles, badges

- `GET /api/users/search?q=` — local `users` table only. Return friendship state per row (`none` / `pending_out` / `pending_in` / `friends`) so the button renders correctly without a second call.
- `GET /api/social/suggestions` — friends of friends, **two hops only**, excluding existing connections and pending requests. Mutual-friend count, ordered descending, cap 20.
- `GET /api/users/:id/profile` — visible to accepted friends and group-sharers; public content only for anyone else.
- `POST /api/users/:id/endorse` — **reject with 403 unless the endorser has a `track_saves` row with `origin_id = :id`.** Enforce in SQL, in `repo.ts`, not in the route.
- Badge tiers in `server/src/badges.ts` as an exported const array — they'll need retuning with real data and must never be inline literals.

**Display rules:** tiers only, never raw counts. All endorsement chips render at one weight — varying weight by count is a count wearing a costume. **The `Listener` tier renders nowhere except your own profile** — it's the default, so showing it on every row in Social is noise that drowns the tiers that mean something.

---

### P5-5 · The shared page

The only screen outside Telegram. No session, no nav, no back button, no Telegram chrome, no `?token=`.

Same dark theme as the app — it's a live preview of the product, which converts better than a marketing skin. Its own header with the logo. Read-only: no save, no queue, no `⋯` menu. **No credits** — a stranger shouldn't get a map of who passed what to whom.

Persistent CTA: `Open in Telegram`.

---

## Phase 6 — Home
*Last, because it's a window onto everything else and needs content to show.*

`GET /api/home` — **one payload, one request.** Not five parallel calls; the landing view is what eats the cold start.

Five sections: Continue listening (last ~10 distinct, deduped) · Your playlists (6, recently modified) · Friend activity (opt-in only) · From your friends (6 shared playlists) · Unsorted nudge (only at 5+ unsorted tracks).

**Every section is independently omittable, and a section with no content renders nothing at all** — no header, no placeholder row. A new user with one track and no friends must see a coherent screen, not four empty shelves. Build and check all four fullness levels: empty, solo, social, returning.

**Nothing lives only on Home.** Home is ranked and finite; anything reachable only there becomes unreachable once it scrolls off.

---

## Consolidated don'ts

**Security and data**
- Don't loosen the owner-scoped repo functions — add separately-named listener-scoped ones
- Don't let any mutation route use a listener-scoped lookup
- Don't accept a bare `trackId` on an unauthenticated shared route
- Don't log query strings
- Don't default anything to public; don't build a global "share everything" switch
- Don't render a username to someone who has no relationship with that person

**Architecture**
- Don't touch the streaming proxy itself — only the authorization above it changes
- Don't create The Crate as a real playlist row
- Don't create a playlist for `/album` — set the `album` column
- Don't add a follows/followers table — friends-of-friends is two-hop traversal
- Don't traverse the friend graph past two hops
- Don't hold ingest session state in memory
- Don't add an i18n framework

**Free tier**
- Don't fan Home out into multiple requests
- Don't poll any endpoint in the background or while its tab is closed
- Don't run expiry on a timer or cron — evaluate lazily
- Don't leave `plays` unpruned

**UX**
- Don't build a global search tab
- Don't display raw save or endorsement counts
- Don't render placeholder rows for people who opted out
- Don't insert "play next" at absolute index 0
- Don't leave queue actions silent
- Don't use a confirmation dialog where undo will do
- Don't build any UI for `origin_adder_id` yet
- Don't attempt to backfill group history or enumerate group members
- Don't treat a missing Telegram profile photo as an error

---

## Definition of done, per task

- [ ] Migration has a working `.down.sql`
- [ ] All SQL is in `repo.ts`
- [ ] New track columns are in `TRACK_COLUMNS`, and cover bytes still aren't pulled incidentally
- [ ] Invisible resources return 404, never 403
- [ ] Every read path filters `deleted_at IS NULL`
- [ ] No new unbounded-growth table without a prune
- [ ] Frontend: verified inside Telegram on a real phone, not just a browser
- [ ] Frontend: safe areas from Telegram's values, not CSS `env()`
- [ ] Frontend: any drag interaction has a single-tap alternative
- [ ] `npm run typecheck` and `npm run lint` pass

---

## Where to start reading, if you need context

- **The storage strategy:** `audio-ingest.ts` and the `/stream` handler in `routes/tracks.ts` — together they're the whole idea
- **Identity:** `telegram-auth.ts`, then `middleware.ts`
- **Data rules:** `repo.ts` — every query and every ownership check is in that one file
- **The UI:** `App.tsx` for state and views, then `context/PlayerContext.tsx` for playback
