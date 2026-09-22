# 002 — Make the artwork settle a beat early, and let a dragged-away close match the slower open

- **Status**: DONE
- **Commit**: 29a8fbc
- **Severity**: MEDIUM
- **Category**: Cohesion & tokens / Interruptibility
- **Estimated scope**: 2 files (`web/src/index.css`, `web/src/views/PlayerView.tsx`), depends on plan 001

## Problem

**Part A — the artwork doesn't actually land early.** `web/src/index.css:752-757`
documents the intended choreography of the bar-to-player transition:

```
/* src/index.css:752-757 — current comment */
/* --- The focal moment -------------------------------------------------------

   The Now Playing bar becoming the full player. The player mounts with its
   artwork already at the size and position of the disc in the bar and lets it
   grow into place, so the 42px disc and the 196px square read as one object
   that got closer rather than two views that swapped.
```

and, a few lines below, at `index.css:783-784`:

```
/* src/index.css:783-784 — current comment */
/* The artwork inside it, travelling on its own clock so it lands a beat before
   the rest of the screen settles. */
```

But the code gives the artwork the exact same clock as the sheet, not its own:

```css
/* src/index.css:775-793 — current */
.nav-player-in {
  animation: nav-player-in var(--dur-focal) var(--ease) both;
}
/* … */
.nav-art-in {
  animation: nav-art-in var(--dur-focal) var(--ease) both;
}
```

Both run for the identical `var(--dur-focal)` on the identical curve, so they
finish at the same instant — the artwork never actually lands "a beat before."
For a transition the user explicitly called out as one to make feel more
satisfying, this is the cheapest available win: it's a one-line duration
change that makes the code do what its own comment already says it should.

**Part B — closing by dragging doesn't match closing by the chevron.**
`web/src/views/PlayerView.tsx:718-794` (`useDragToDismiss`) handles letting go
of a drag in two ways: springing back to rest (the drag didn't travel far
enough) or continuing on down to close. Both currently share one transition,
`.nav-player-settle`:

```css
/* src/index.css:945-956 — current */
.nav-player-settle {
  transition:
    transform var(--dur-state) var(--ease),
    opacity var(--dur-state) var(--ease);
}
```

```ts
// src/views/PlayerView.tsx:771-794 — current
const onEnd = () => {
  if (!tracking) return;
  const wasEngaged = engaged;
  tracking = false;
  engaged = false;
  if (!wasEngaged) {
    root.style.transition = "";
    return;
  }

  root.classList.add("nav-player-settle");
  if (travelled > root.clientHeight * DISMISS_FRACTION) {
    haptic.tap();
    root.style.transform = `translateY(${root.clientHeight}px)`;
    root.style.opacity = "0";
    // Unmounting on the transition rather than a guessed delay would be
    // better, except a cancelled transition never fires one and the
    // player would stay stuck offscreen.
    window.setTimeout(() => closeRef.current(), 200);
    return;
  }
  root.style.transform = "";
  root.style.opacity = "";
};
```

`--dur-state` is 200ms — correctly snappy for the spring-back case (the user's
gesture didn't mean to close anything; per `AUDIT.md` §4 this is "the system's
response" and should snap). But the *dismiss* branch is a deliberate close,
the exact same event as tapping the chevron (`dismiss`, `PlayerView.tsx:121-124`),
which — once plan 001 lands — takes 460ms (`.nav-player-out`, `calc(var(--dur-focal) - 140ms)`
with `--dur-focal` at 600ms). A drag-to-close finishing in 200ms right next to
a chevron-close that takes more than twice as long is an inconsistency the
user will feel even without being able to name it: the same action, closing
the same screen, at two different speeds depending only on which affordance
was used.

## Target

**Part A:**

```css
/* target — src/index.css:792-793 */
.nav-art-in {
  animation: nav-art-in calc(var(--dur-focal) - 100ms) var(--ease-settle) both;
}
```

(This assumes plan 001's `--ease` → `--ease-settle` swap on this rule has
already been applied, or is applied in the same pass. If plan 001 has not
been applied yet, use `var(--ease)` here instead and revisit once it is.)

**Part B:** give the drag-to-dismiss's "falls the rest of the way" outcome its
own class, on the same clock and curve as the chevron's `.nav-player-out`,
while leaving the spring-back on the fast, unchanged `.nav-player-settle`.

```css
/* target — src/index.css, new rule placed directly after .nav-player-settle (index.css:945-956) */
/* The player continuing on down after a drag crossed the dismiss threshold.
   Same clock as the chevron's own close (.nav-player-out) — the same event,
   so it must take the same time regardless of which affordance triggered it. */
.nav-player-drag-out {
  transition:
    transform calc(var(--dur-focal) - 140ms) var(--ease-in),
    opacity calc(var(--dur-focal) - 140ms) var(--ease-in);
}
```

```ts
// target — src/views/PlayerView.tsx, onEnd (currently lines 771-794)
const onEnd = () => {
  if (!tracking) return;
  const wasEngaged = engaged;
  tracking = false;
  engaged = false;
  if (!wasEngaged) {
    root.style.transition = "";
    return;
  }

  if (travelled > root.clientHeight * DISMISS_FRACTION) {
    haptic.tap();
    root.classList.add("nav-player-drag-out");
    root.style.transform = `translateY(${root.clientHeight}px)`;
    root.style.opacity = "0";
    // Unmounting on the transition rather than a guessed delay would be
    // better, except a cancelled transition never fires one and the
    // player would stay stuck offscreen. Matches .nav-player-drag-out's
    // own duration (PLAYER_OUT_MS — see the constant beside PLAYER_OUT_MS).
    window.setTimeout(() => closeRef.current(), PLAYER_OUT_MS);
    return;
  }
  root.classList.add("nav-player-settle");
  root.style.transform = "";
  root.style.opacity = "";
};
```

`PLAYER_OUT_MS` (`PlayerView.tsx:666`) already exists and already means
"however long `.nav-player-out` takes" — reuse it verbatim rather than writing
`200` or a second constant. Its own comment already ties it to `--dur-focal`:

```ts
// src/views/PlayerView.tsx:665-666 — current, unchanged by this plan
/** Matches .nav-player-out — --dur-focal (460ms) less the 140ms it trims. */
const PLAYER_OUT_MS = 320;
```

Once plan 001 raises `--dur-focal` to 600ms, update this comment and constant
together (they must stay in sync, as the comment already insists): `Matches
.nav-player-out — --dur-focal (600ms) less the 140ms it trims.` and
`const PLAYER_OUT_MS = 460;`. `.nav-player-drag-out`'s CSS duration
(`calc(var(--dur-focal) - 140ms)`) will already be 460ms automatically once
plan 001 lands, since it derives from the same token — only the JS constant
needs a manual update, because JS cannot read a CSS `calc()`.

## Repo conventions to follow

- Duration relationships are expressed as `calc()` off a shared token, never a second hand-typed number — see `.nav-view-pop` (`calc(var(--dur-view) - 60ms)`) and `.nav-player-out` itself (`calc(var(--dur-focal) - 140ms)`) as exemplars. `.nav-player-drag-out` follows the same pattern, reusing the exact same `- 140ms` offset as `.nav-player-out` because it is the same conceptual close.
- JS timeouts that must match a CSS transition already exist as a named constant with a comment pointing at the CSS rule it mirrors — `PLAYER_OUT_MS` at `PlayerView.tsx:665-666` is the exemplar this plan extends to a second call site rather than duplicating.
- The asymmetric-timing rule ("deliberate phases animate slower; the system's response snaps") is already stated in `AUDIT.md` §4 and is exactly why the spring-back stays on `.nav-player-settle`/`--dur-state` while the actual dismissal moves to the slower clock.

## Steps

1. In `web/src/index.css`, change `.nav-art-in`'s `animation:` line (currently at `index.css:792-793`, or wherever plan 001 left it) to `calc(var(--dur-focal) - 100ms)` in place of `var(--dur-focal)`.
2. In `web/src/index.css`, immediately after the `.nav-player-settle` rule (`index.css:945-956`), add the new `.nav-player-drag-out` rule shown in Target, with the comment shown.
3. In `web/src/views/PlayerView.tsx`, in `useDragToDismiss`'s `onEnd` (currently `PlayerView.tsx:771-794`): move `root.classList.add("nav-player-settle")` down into the spring-back branch (right before the final `root.style.transform = "";`), and in the dismiss branch add `root.classList.add("nav-player-drag-out")` instead, before setting `transform`/`opacity`. Change the `window.setTimeout(() => closeRef.current(), 200)` call to use `PLAYER_OUT_MS` instead of the literal `200`.
4. If plan 001 has already been applied (i.e. `--dur-focal` is 600ms), update `PlayerView.tsx:665-666`'s comment and constant: `/** Matches .nav-player-out — --dur-focal (600ms) less the 140ms it trims. */` and `const PLAYER_OUT_MS = 460;`. If plan 001 has not been applied yet, leave the constant at its current value and revisit once it is.

## Boundaries

- Do NOT change `DISMISS_FRACTION`, `ENGAGE_AT`, or any of the gesture-recognition logic above `onEnd` (the scroller-ownership handoff, the axis lock) — this plan only changes how long the already-decided outcomes take to animate, not when they trigger.
- Do NOT add velocity-based dismissal (flick-to-close). That is a real, separate gap (every drag/swipe gesture in this app — the player, `useSwipeQueue`, `useSwipeRemove` — uses distance thresholds only) but it is a gesture-recognition change, not a timing one, and is out of scope for this plan.
- Do NOT touch `.nav-player-settle` itself — the spring-back must stay on `--dur-state` (200ms), unchanged.
- Do NOT change `.nav-player-out` (the chevron-triggered exit) — `.nav-player-drag-out` is a new, separate rule so the two call sites (chevron vs. drag) can each keep their own class, even though the values match.
- This plan assumes plan 001 either already landed or lands in the same pass. If applying this plan alone, use `var(--ease)` (not `--ease-settle`) in step 1, and use the *current* `--dur-focal` (460ms) when computing what `PLAYER_OUT_MS` and the drag-out rule resolve to — do not hand-write a duration that doesn't match the live token.

## Verification

- **Mechanical**: `cd web && npm run lint` and `cd web && npx tsc -b --noEmit` (or `npm run build`) both pass.
- **Feel check**: run the app, open the player from the Now Playing bar, then:
  - Watch the artwork specifically: it should visibly stop growing/reshaping slightly before the rest of the sheet (title, transport, scrubber) finishes arriving, rather than everything locking into place at the exact same instant.
  - Drag the player down past roughly a fifth of the screen height and release: it should fall away and fully close over the same span of time the chevron-triggered close takes (compare by timing both with a stopwatch, or in DevTools' Animations panel — they should be within a few ms of each other, not 200ms vs. ~460ms).
  - Drag the player down a small amount (well under the dismiss threshold) and release: it should spring back to rest quickly — this must NOT have gotten slower. If the spring-back now feels sluggish, `.nav-player-settle` was changed by mistake; it must stay on `--dur-state`.
  - In DevTools → Animations, capture a drag-release dismissal and confirm no visible stutter or flash at the moment `.nav-player-drag-out` is added mid-gesture (the class only adds a transition; it must not reset the `transform`/`opacity` the drag already set).
  - Toggle `prefers-reduced-motion`: both branches still collapse via the existing blanket rule at `index.css:1225-1236` (it targets `transition-duration`/`animation-duration` generically, not class names), so no code path should hang waiting for a transition that reduced motion shortened to 1ms.
- **Done when**: the artwork's keyframe duration is `calc(var(--dur-focal) - 100ms)`, a new `.nav-player-drag-out` rule exists matching `.nav-player-out`'s duration/curve, `onEnd` uses it for the dismiss branch only, the unmount timeout uses `PLAYER_OUT_MS` instead of a literal `200`, and both mechanical checks pass.
