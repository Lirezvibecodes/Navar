# Navaar roadmap — Android, cache, loading, player, welcome, lyrics

## Context

Six things the app needs, done one at a time, each landing green before the
next starts. Nothing here is a rewrite: every task either finishes something
already half-built or fixes something already proven broken.

Two findings from exploration shape most of it.

**Android is not broken by chance.** `--tg-viewport-height` is computed in
[telegram.ts:139](web/src/telegram.ts#L139) and read by nobody, so `#root`
sizes to `100%` of the whole WebView rather than the part of it Telegram is
actually showing. `web/index.html` has no `viewport-fit=cover`, so
`env(safe-area-inset-*)` is zero on Android too, and Telegram's own
`safeAreaInset` reports `0` on plenty of Android devices that do have a gesture
bar — which means the bottom nav has no correct number to sit on. Six
`backdrop-filter` declarations have no fallback, and `.nav-tab` animates
`padding` and `max-width` on a blurred element — the one place the CSS file
knowingly breaks its own motion rule. Every fixed overlay (`Sheet`, toast,
crate action bar, player) is pinned `inset: 0`, so the Android keyboard covers
them. These are the "navbar, liquid glass, pop-up screen" symptoms.

**Everything reloads because of one line.** `key={seq.current}` on the view
wrapper in [App.tsx](web/src/App.tsx) forces a remount on every navigation —
deliberately, because the view transitions need it. So every view refetches
from scratch. The fix belongs in the data layer, not the nav layer.

Lyrics turned out to be ~90% built already (migration 006, `getTrackLyrics`,
`GET /api/tracks/:id/lyrics`, `web/src/lib/lyrics.ts`, `LyricsPane`, and
`PATCH /api/tracks/:id` already accepts a `lyrics` field). The only hole is
that nothing ever writes one. LRCLIB fills it automatically.

---

## Task 1 — Android correctness

Nothing visual changes on iOS; every fix is a fallback that iOS already
satisfies.

**Viewport height.** `applyViewport` keeps writing `--tg-viewport-height`, and
now something reads it: `#root` in [index.css](web/src/index.css) becomes
`height: var(--tg-viewport-height, 100%)`. Add a `visualViewport` resize
listener in `initTelegramPlatform` alongside the existing `viewportChanged`
wiring — Android Telegram does not always fire `viewportChanged` for the
keyboard, and `window.visualViewport.height` does.

**Safe insets.** Add `viewport-fit=cover` to the meta tag in
`web/index.html` (currently absent, which is why `env()` is dead on Android
too). Then `applyInsets` writes its Telegram numbers to
`--tg-safe-top-tg` / `--tg-safe-bottom-tg`, and the CSS tokens become
`--tg-safe-bottom: max(var(--tg-safe-bottom-tg), env(safe-area-inset-bottom, 0px))`.
On iOS `env()` is 0 and Telegram's number wins, exactly as today; on Android
Telegram's 0 loses to the real gesture-bar inset. The file's existing comment
about `env()` being useless in the iOS Mini App WebView stays true and gets
extended to say why `max()` is the right combinator.

**Glass fallback.** Wrap the six `backdrop-filter` sites so each has a
`@supports not (backdrop-filter: blur(1px))` branch that raises the background
alpha to a solid-enough surface. Android WebView also silently no-ops the blur
under battery saver while still reporting support, so the base alpha of
`.nav-glass` and `.nav-tab` goes up enough that an unblurred surface still
reads as a surface rather than a transparent smear.

**Nav tab.** Remove `backdrop-filter` from `.nav-tab` — the nav container
behind it already carries the glass, so the pill was paying to re-rasterise a
blur every frame of a `padding`/`max-width` transition. Keep the pill's
background and the label reveal, but drive the reveal off `transform`/`opacity`
instead of layout so it costs nothing on a weak GPU.

**Fixed overlays.** `Sheet` ([ui.tsx:636](web/src/components/ui.tsx#L636)),
the toast ([ToastContext.tsx:111](web/src/context/ToastContext.tsx#L111)), the
crate action bar ([CrateView.tsx:367](web/src/views/CrateView.tsx#L367)) and
the player ([PlayerView.tsx:139](web/src/views/PlayerView.tsx#L139)) stop using
`inset: 0` and size to `height: var(--tg-viewport-height, 100%)` from `top: 0`.
With the visualViewport listener above, the keyboard then shrinks them instead
of hiding them.

**Vertical swipe.** `disableVerticalSwipes` is gated at client 7.7 with no
fallback, so on older Android Telegram a drag inside the player collapses the
app. Add `overscroll-behavior: contain` to `.nav-scroll` and `touch-action:
pan-y` on the player's drag surfaces as the version-independent floor.

*Verify:* open on an Android device — nav sits above the gesture bar, sheets
open fully and survive the keyboard, glass reads as glass, tab switch is
smooth. `npx tsc -b`, `npm run lint`, `npm run build` in `web/`.

---

## Task 2 — Loading screen

Today `web/index.html` is a bare `#root`, and `Boot()` in `App.tsx` renders an
**empty div** while `me` is null. So the sequence a cold start actually shows
is: blank → blank → app.

Add an inline `#boot` splash in `web/index.html` — markup and CSS inline in the
document, no bundle needed, so it paints on the first frame before any JS runs.
Background `#030303` (matching `--color-nav-bg`) kills the white flash. The
Navaar wordmark in a system fallback face, since Pixelify Sans has not loaded
yet, plus a slow pixel-block progress indicator.

`main.tsx` fades `#boot` out and removes it once React has committed **and**
`Boot()` has resolved `me` — not on mount, or the splash cuts to an empty
screen. `Boot()` gains real states: loading (splash stays), error (a retry
button rather than today's bare `Empty`), ready. Minimum splash time ~450ms so
a warm start does not flash.

*Verify:* hard reload on a cold Render dyno (the ~30s wake) — splash holds the
whole time instead of a white screen; kill the network and confirm the error
state offers a retry that actually re-runs auth.

---

## Task 3 — Caching

**Client.** New `web/src/lib/cache.ts`: a module-level `Map` holding
`{ data, fetchedAt, inflight }` plus a `useCached(key, fetcher, ttl)` hook with
stale-while-revalidate semantics — cached data returns *synchronously on
mount*, so a revisited screen paints instantly, and a background revalidate
fires only if the entry is older than its TTL. Concurrent callers share one
in-flight promise. Because it lives outside React, it survives the
`key={seq.current}` remount that causes the problem in the first place; the
navigation model is untouched.

Applied to the reads that repeat on every visit: `/api/home` (60s), playlist
tracks, album and artist tracks, `getProfile`, `listFriends`,
`friendSuggestions`, and `socialActivity` — which keeps its 30s poll but now
seeds from cache instead of showing a spinner each time the Social tab opens.

Invalidation piggybacks on the mutations `LibraryContext` already performs:
`putTrack` / `dropTracks` / `putPlaylist` / `dropPlaylist` / `markInPlaylist` /
`setFavorite` each drop the key prefixes they affect. `LibraryContext` itself
keeps its own boot fetch — it is already a cache and does not change.

**Server.** `express.static(webDist)` in [app.ts:76](server/src/app.ts#L76)
serves hashed Vite assets with no cache headers, so every cold open re-downloads
the whole bundle. Add `maxAge: '1y', immutable: true` for `/assets` and
`no-cache` for `index.html` — the filenames are content-hashed, so this is safe
by construction. Add `Cache-Control: private, max-age=300` to
`/api/tracks/:id/lyrics`. Covers and avatars already have headers and are left
alone.

*Verify:* navigate Home → Crate → Home and watch the network panel — the second
Home is served from cache with a background revalidate, not a blocking fetch.
Edit a track title and confirm the affected screens show the new title
immediately. Second page load fetches `index.html` only.

---

## Task 4 — Player background from the cover art

Today [PlayerView.tsx:139](web/src/views/PlayerView.tsx#L139) is flat `#030303`
with one static radial that is the same for every song.

New `web/src/lib/palette.ts` draws the cover into a 16×16 offscreen canvas and
buckets the pixels in HSL. Covers are same-origin (`?token=` in the query
string rather than an `Authorization` header), so the canvas does not taint and
`getImageData` works — this was checked.

**The readability guarantee is the point of the design, not an afterthought.**
The extracted hue is used, but its lightness and saturation are not: every
background stop is re-emitted at a clamped `L` in the 12–22% band and `S`
capped at ~55%, so the backdrop is dark by construction no matter what the
cover looks like — a white album sleeve and a neon one both land in the same
darkness range, only differently tinted. On top of that, the contrast ratio of
`#fff` against the composited stop is computed and the stop is darkened further
if it is under 7:1. And a fixed scrim
(`linear-gradient(to bottom, transparent 40%, rgba(3,3,3,.85) 78%, #030303)`)
sits between the gradient and the text block, so title, artist and controls
always land on near-black regardless of what extraction returned. Three
independent guarantees, so no cover can produce unreadable text.

The palette is cached per track id in the Task 3 cache — colours never change
for a track — and crossfades over `--dur-focal` when the track changes, with
the transition dropped under `prefers-reduced-motion`. Extraction failure falls
back to exactly today's static radial, so nothing regresses.

*Verify:* play a dark cover, a blown-out white cover, and a saturated neon one;
confirm the title stays clearly readable in all three and the transition
between them is smooth. Confirm a track with no cover renders today's look.

---

## Task 5 — First-time welcome

New `web/src/components/Welcome.tsx`, shown before `ChooseName` when
`me.handle == null`. Three cards, swipeable with dots, friendly and short:

1. **"Hey — welcome to Navaar."** Your music, kept in Telegram, played properly.
2. **"Send a song to the bot."** It lands in your Crate, artwork and all.
3. **"Music's better shared."** Friends, what they're playing, playlists you can pass around.

Then a "Let's pick your name" button that hands off to the existing
`ChooseName` screen, unchanged. Seen-state in `localStorage` keyed by user id,
so changing your name later never re-shows it.

Reuses what `ChooseName` already established: the `margin: auto 0` centring
that keeps the card off the keyboard, the pixel icon set, the existing motion
tokens. Copy is written to be warm rather than salesy — it is a hello, not an
onboarding funnel.

*Verify:* clear the session token and the seen key, reload, and walk the whole
first-run path: welcome → name → empty crate. Then reload again and confirm the
welcome does not reappear.

---

## Task 6 — Lyrics via LRCLIB

Everything except the write path exists. Adding one.

New `server/src/lyrics-provider.ts`:
`GET https://lrclib.net/api/get?artist_name=&track_name=&album_name=&duration=`,
falling back to `/api/search` on a 404. Prefers `syncedLyrics` (which
`web/src/lib/lyrics.ts` already karaokes) and takes `plainLyrics` otherwise.
Sends a `User-Agent` identifying Navaar, as LRCLIB asks. 4s timeout, no
retries, returns `null` on anything unexpected — the same "treated as weather"
rule `audio-ingest.ts` states about Telegram. **A lyrics lookup may never fail
a request.**

Wired into the existing `GET /api/tracks/:id/lyrics`
([tracks.ts:145](server/src/routes/tracks.ts#L145)): if `getTrackLyrics`
returns null and the track has not been checked before, call the provider, and
on a hit persist through the existing update path so it is fetched exactly
once, ever. Migration `012_lyrics_lookup` adds
`lyrics_checked_at TIMESTAMPTZ` — the "don't ask twice" marker, so a track
LRCLIB does not have costs one lookup in its lifetime, not one per play. No
background job and no scan: the call happens only when someone actually opens
the Lyrics pane, which keeps it inside the free-tier request budget.

Only what the user is sent to a third party: title, artist, album, duration.
Nothing identifying.

Client: the Lyrics segment in `PlayerView.tsx` currently hides itself when
`has_lyrics` is false, so nobody ever discovers the feature. It becomes
permanent, with the pane showing "Looking for lyrics…" during the lookup, the
words on a hit, and "No lyrics found for this one" on a miss. The current empty
copy — "Add them from the track's Edit details" — points at a control that does
not exist and goes away.

*Verify:* apply 012 to production, open a well-known track's Lyrics pane and
confirm timed lyrics scroll in sync; reopen and confirm no second outbound call.
Open an obscure track and confirm the miss is recorded and the pane says so.
Server `npm run typecheck` and the 61-test suite stay green.

---

## Task 7 — `/impeccable` revision (last)

After all six land: run
`node .claude/skills/impeccable/scripts/context.mjs`, read every screenshot in
[v1.0.1/THE UI REFERENCE/](v1.0.1/THE%20UI%20REFERENCE/) — including the two
bottom-navbar references and the font-weight/liquid-glass sheet — and produce a
**written list of proposed changes for approval before editing anything**.
No files are touched until that list is approved. The skill's
`reference/android.md` is about native Material 3 apps and does not apply to a
Mini App WebView; it gets skipped.

---

## Order and ground rules

Android → loading screen → cache → player gradient → welcome → lyrics →
impeccable. Android goes first because it is the correctness floor everything
else lands on; the loading screen goes before the cache so boot states exist to
hang the splash off.

One task at a time, each finished and verified before the next begins. After
every task: `npm --prefix server run typecheck`, `npx tsc -b` /
`npm run lint` / `npm run build` in `web/`, and the 61-test visibility suite —
all green, or the task is not done. No existing behaviour changes unless this
plan says it does.

---

## Task 7 — done

The list was produced, approved in full, and applied. Thirty-one items, plus
the typography and UX-copy revision that came with the approval. What landed,
grouped:

**Failure states.** Every screen that could fail silently now says so and
offers a way back: Home, the track-list screens, the playlist screen, and
playback itself. `errorToast` reads a real message out of a thrown error
instead of printing a fallback over the top of it, and the toast now has
kinds — info, error, undo — instead of one grey pill for all three.

**Playback.** `PlayerContext` carries a `PlaybackStatus`, so the Now Playing
bar can show a track that is loading, stalled, or failed rather than a
play button that does nothing. A failed track can be retried from the bar.

**Reach.** The `⋯` and the heart on a track row were 30px and 26px wide and
sat 11px apart; they are now 40×44 each in a single group with no gap, so a
thumb aiming for one cannot land on the other. The Crate's selection bar no
longer hides its own count behind the Cancel button.

**Layout.** `Screen` and the Crate's selection bar were each adding
`--tg-safe-bottom` on top of a bottom-nav height that already included it,
which paid for the gesture bar twice. Both fixed.

**Ordering.** Every floating layer now sorts on a named `--z-*` token, and
the app shell no longer opens a stacking context that flattened them against
each other — which is why the Crate's selection bar used to paint over the
full player.

**One answer per question.** A `TextField`/`TextArea` pair replaced six
hand-rolled inputs; `PersonTile` replaced the same 48-line tile drawn twice;
the player's pane switcher is the `Chip` the rest of the app filters with;
the grey scale is three tokens instead of fourteen scattered alphas.

**Words.** The Crate is every track you have; your Library is what you have
made of it. Screens that said "library" when they meant the crate now say
Crate. "Pending" and "Request sent" are both "Requested". Titles, empty
states, and the boot page's `<title>` all name Navaar.

Four gates green: `npx tsc -b`, `npm run lint`, `npm run build`,
`npm --prefix server run typecheck`.
