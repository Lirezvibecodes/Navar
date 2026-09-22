# 001 — Slow down and smooth the three view-level motion clocks

- **Status**: DONE
- **Commit**: 29a8fbc
- **Severity**: HIGH
- **Category**: Easing & duration / Cohesion & tokens
- **Estimated scope**: 1 file (`web/src/index.css`), token values + easing swaps only

## Problem

Navaar's whole motion system already runs on four durations and one primary
curve, defined once in `web/src/index.css:592-607`:

```css
/* src/index.css:592-607 — current */
:root {
  --ease: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in: cubic-bezier(0.4, 0, 1, 1);
  --ease-settle: cubic-bezier(0.33, 1, 0.68, 1);

  --dur-tap: 90ms; /* the press itself */
  --dur-state: 200ms; /* a control changing what it means */
  --dur-view: 300ms; /* a screen replacing another */
  --dur-focal: 460ms; /* the bar becoming the player */
  --dur-tab: 340ms; /* one tab opening while another closes */
  --dur-settle: 480ms; /* a dragged row easing back to rest after release */
  --dur-remove: 360ms; /* a swiped-to-remove row leaving before the gap closes */
}
```

The user has asked, in plain terms, for the app to feel slower, smoother and
more satisfying — specifically calling out switching between pages (both the
Home/Library/Social tab bar and the push/pop screen stack) and the Now
Playing bar opening into the full player.

`--dur-view` (push/pop), `--dur-tab` (bottom-tab switch) and `--dur-focal`
(bar → player) are exactly the three clocks that drive those two flows, and
all three currently sit at the terse end of comfortable UI duration budgets.
Their curve, `--ease` (`cubic-bezier(0.16, 1, 0.3, 1)`), is documented at
`index.css:579-582` as an aggressive exponential decay that "snaps almost all
its distance in the first frames" — exactly the opposite of a slow, smooth
arrival.

The file already defines a gentler alternative for this exact purpose —
`--ease-settle` at `index.css:595-598`:

```css
/* src/index.css:595-598 — current */
/* Gentler than --ease: that curve snaps almost all its distance in the
   first frames, which reads as abrupt on a row easing back to rest.
   This one spreads the deceleration out for a softer, smoother settle. */
--ease-settle: cubic-bezier(0.33, 1, 0.68, 1);
```

— but today it is used in exactly one place (`nav-queue-confirm`,
`index.css:1043-1057`), not by any of the three view-level transitions.

Every consumer of `--dur-view`, `--dur-tab` and `--dur-focal` (the animations
themselves and their entrance keyframes) currently pairs them with `--ease`:

```css
/* src/index.css:712-729 — current (push/pop) */
@keyframes nav-push-in {
  from {
    transform: translate3d(22px, 0, 0);
    opacity: 0;
  }
}
@keyframes nav-pop-in {
  from {
    transform: scale(0.97);
    opacity: 0;
  }
}
.nav-view-push {
  animation: nav-push-in var(--dur-view) var(--ease) both;
}
.nav-view-pop {
  animation: nav-pop-in calc(var(--dur-view) - 60ms) var(--ease) both;
}
```

```css
/* src/index.css:741-750 — current (bottom-tab switch, the screen half) */
@keyframes nav-tab-morph-in {
  from {
    transform: scale(0.92) translate3d(0, 10px, 0);
    opacity: 0;
  }
}
.nav-view-tab {
  transform-origin: var(--nav-tab-origin-x, 50%) 100%;
  animation: nav-tab-morph-in var(--dur-view) var(--ease) both;
}
```

```css
/* src/index.css:852-857, 875-878, 916-919 — current (bottom-tab switch, the pill half) */
.nav-tab {
  /* … */
  transition:
    background-color var(--dur-tab) var(--ease),
    border-color var(--dur-tab) var(--ease),
    box-shadow var(--dur-tab) var(--ease),
    transform var(--dur-tap) var(--ease-in),
    opacity var(--dur-tap) var(--ease-in);
}
.nav-tab-disc {
  /* … */
  transition:
    background-color var(--dur-tab) var(--ease),
    color var(--dur-tab) var(--ease),
    box-shadow var(--dur-tab) var(--ease);
}
.nav-tab-label {
  /* … */
  transition:
    max-width var(--dur-tab) var(--ease),
    transform var(--dur-tab) var(--ease),
    opacity calc(var(--dur-tab) * 0.55) var(--ease);
}
```

```css
/* src/index.css:763-808 — current (the focal moment: bar → player) */
@keyframes nav-player-in {
  from {
    transform: translate3d(0, var(--nav-focal-dy, 60vh), 0);
    opacity: 0;
  }
}
.nav-player-in {
  animation: nav-player-in var(--dur-focal) var(--ease) both;
}
@keyframes nav-art-in {
  from {
    transform: translate3d(var(--nav-art-dx, 0px), var(--nav-art-dy, 0px), 0)
      scale(var(--nav-art-scale, 0.21));
    border-radius: 50%;
  }
}
.nav-art-in {
  animation: nav-art-in var(--dur-focal) var(--ease) both;
}
@keyframes nav-backdrop-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
.nav-backdrop-in {
  animation: nav-backdrop-in var(--dur-focal) var(--ease) both;
}
```

```css
/* src/index.css:935-942 — current (Now Playing bar's own first appearance, same clock family) */
@keyframes nav-bar-in {
  from {
    transform: translate3d(0, calc(100% + 12px), 0);
    opacity: 0;
  }
}
.nav-bar-in {
  animation: nav-bar-in var(--dur-view) var(--ease) both;
}
```

## Target

Raise the three view-level durations, and move every one of the animations
above from `--ease` to the already-existing `--ease-settle`. Nothing else
about them changes — same keyframes, same properties, same `both` fill mode,
same relative-to-entrance formulas for the faster exits.

```css
/* target — src/index.css:592-607 */
:root {
  --ease: cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in: cubic-bezier(0.4, 0, 1, 1);
  --ease-settle: cubic-bezier(0.33, 1, 0.68, 1);

  --dur-tap: 90ms; /* the press itself */
  --dur-state: 200ms; /* a control changing what it means */
  --dur-view: 380ms; /* a screen replacing another */
  --dur-focal: 600ms; /* the bar becoming the player */
  --dur-tab: 420ms; /* one tab opening while another closes */
  --dur-settle: 480ms; /* a dragged row easing back to rest after release */
  --dur-remove: 360ms; /* a swiped-to-remove row leaving before the gap closes */
}
```

`--dur-tap` and `--dur-state` are deliberately **not** touched — see
Boundaries.

Every `var(--ease)` paired with `var(--dur-view)`, `var(--dur-tab)` or
`var(--dur-focal)` becomes `var(--ease-settle)`:

```css
/* target — push/pop */
.nav-view-push {
  animation: nav-push-in var(--dur-view) var(--ease-settle) both;
}
.nav-view-pop {
  animation: nav-pop-in calc(var(--dur-view) - 60ms) var(--ease-settle) both;
}
```

```css
/* target — bottom-tab switch, the screen half */
.nav-view-tab {
  transform-origin: var(--nav-tab-origin-x, 50%) 100%;
  animation: nav-tab-morph-in var(--dur-view) var(--ease-settle) both;
}
```

```css
/* target — bottom-tab switch, the pill half (tap-press lines unchanged) */
.nav-tab {
  transition:
    background-color var(--dur-tab) var(--ease-settle),
    border-color var(--dur-tab) var(--ease-settle),
    box-shadow var(--dur-tab) var(--ease-settle),
    transform var(--dur-tap) var(--ease-in),
    opacity var(--dur-tap) var(--ease-in);
}
.nav-tab-disc {
  transition:
    background-color var(--dur-tab) var(--ease-settle),
    color var(--dur-tab) var(--ease-settle),
    box-shadow var(--dur-tab) var(--ease-settle);
}
.nav-tab-label {
  transition:
    max-width var(--dur-tab) var(--ease-settle),
    transform var(--dur-tab) var(--ease-settle),
    opacity calc(var(--dur-tab) * 0.55) var(--ease-settle);
}
```

```css
/* target — the focal moment */
.nav-player-in {
  animation: nav-player-in var(--dur-focal) var(--ease-settle) both;
}
.nav-art-in {
  animation: nav-art-in var(--dur-focal) var(--ease-settle) both;
}
.nav-backdrop-in {
  animation: nav-backdrop-in var(--dur-focal) var(--ease-settle) both;
}
```

(`.nav-art-in`'s duration is further trimmed relative to `.nav-player-in` by
plan 002 — apply that plan after this one, or in the same edit pass, since
both touch this rule.)

```css
/* target — Now Playing bar's first appearance */
.nav-bar-in {
  animation: nav-bar-in var(--dur-view) var(--ease-settle) both;
}
```

`nav-player-out` (the exit) is intentionally left on `--ease-in` — see
Boundaries. Because it is defined as `calc(var(--dur-focal) - 140ms)`, it
automatically becomes 460ms once `--dur-focal` is 600ms, keeping the same
"exit is faster than entrance" ratio the file already documents. Likewise
`.nav-view-pop`'s `calc(var(--dur-view) - 60ms)` automatically becomes 320ms.

## Repo conventions to follow

- All motion tokens live in the single `:root` block at `src/index.css:592-607` — do not add new tokens, only change the two duration values and reuse the existing `--ease-settle` curve.
- The file's own rule, stated at `src/index.css:584-585`: "Exits are faster than entrances everywhere." Every exit curve (`--ease-in`, used by `.nav-player-out`, `.nav-view` pop... no — pop is an entrance, see Boundaries) stays exactly as it is.
- Exemplar for the reuse being made here: `nav-queue-confirm` (`src/index.css:1052-1057`) is the one existing consumer of `--ease-settle`; the comment right above the token definition (`index.css:595-598`) is the rationale to lean on if anyone asks why this curve was chosen for the swap.

## Steps

1. In `web/src/index.css:602-604`, change `--dur-view: 300ms;` → `--dur-view: 380ms;`, `--dur-tab: 340ms;` → `--dur-tab: 420ms;`, `--dur-focal: 460ms;` → `--dur-focal: 600ms;`. Leave every other token in that block untouched.
2. At `index.css:724-729` (`.nav-view-push`, `.nav-view-pop`), replace `var(--ease)` with `var(--ease-settle)` in both `animation:` declarations. Do not touch the `calc(...)` subtraction.
3. At `index.css:747-750` (`.nav-view-tab`), replace `var(--ease)` with `var(--ease-settle)`.
4. At `index.css:852-857` (`.nav-tab`), replace `var(--ease)` with `var(--ease-settle)` on the three non-tap lines (`background-color`, `border-color`, `box-shadow`). Leave the two `var(--ease-in)` tap lines exactly as they are.
5. At `index.css:875-878` (`.nav-tab-disc`), replace all three `var(--ease)` with `var(--ease-settle)`.
6. At `index.css:916-919` (`.nav-tab-label`), replace all three `var(--ease)` with `var(--ease-settle)`.
7. At `index.css:776` (`.nav-player-in`) and `index.css:808` (`.nav-backdrop-in`), replace `var(--ease)` with `var(--ease-settle)`. (`.nav-art-in` at `index.css:793` is handled by plan 002, which also changes its duration — if plan 002 is not being applied in the same pass, still swap `var(--ease)` → `var(--ease-settle)` here so it does not fall out of step with its sibling animations.)
8. At `index.css:942` (`.nav-bar-in`), replace `var(--ease)` with `var(--ease-settle)`.
9. Leave `.nav-player-out` (`index.css:779`) untouched — it stays on `--ease-in`.

## Boundaries

- Do NOT change `--dur-tap` (90ms) or `--dur-state` (200ms), and do NOT touch anything whose transition uses them — button press feedback, hover/toggle color changes, the play/pause glyph cross-fade, sheet backdrop fades, the drag-release spring-back. Emil Kowalski's frequency rule (`AUDIT.md` §1) and this file's own header comment both say the system's response to input must stay snappy; slowing those down would make every tap feel laggy, which is the opposite of "satisfying."
- Do NOT touch `--dur-settle` or `--dur-remove` — unrelated to page switching or the player, out of scope.
- Do NOT change any `--ease-in` usage (press release, `.nav-player-out`, `.nav-sheet` closing transform, swipe-remove leaving) — those are documented, deliberate exits and are correct as-is.
- Do NOT change any keyframe's `from`/`to` values, any `transform-origin`, or any markup/structure — duration and easing tokens only.
- Do NOT add new CSS custom properties. Reuse `--ease-settle`, which already exists.
- If any cited line number has drifted from what is shown above (the file has moved since commit `29a8fbc`), find the rule by its selector/comment instead and STOP to report if the surrounding code no longer matches what's quoted here.

## Verification

- **Mechanical**: `cd web && npm run lint` (oxlint) must pass with no new warnings. `cd web && npx tsc -b --noEmit` (or `npm run build`) must succeed — this plan touches no `.ts`/`.tsx`, so it should be a no-op for the type check, but confirms nothing else broke.
- **Feel check**: run the app (`npm run dev` inside `web/`, or the project's own `run` skill), then:
  - Switch between Home, Library and Social several times. The capsule should visibly take longer to stretch and the incoming screen should decelerate into place more gradually than before — it should no longer feel like it "snaps" to rest.
  - Push into a track row, then a playlist, then pop back twice. The push should feel like a clear glide in from the right; pop should still feel quicker than push (it is `calc(var(--dur-view) - 60ms)`, now 320ms vs. 380ms).
  - Tap the Now Playing bar to open the full player. The artwork and the sheet should take noticeably longer to arrive than before, and the deceleration at the end should read as a soft landing rather than an abrupt stop.
  - Tap a button (transport controls, the heart, a tab). Press feedback must still feel instant — if it now feels sluggish, `--dur-tap`/`--dur-state` were touched by mistake; they must not be.
  - In Chrome DevTools → More tools → Animations, capture the tab-switch and the player-open animations and play them back at 10%: confirm the curve visibly spends more time decelerating near the end (matching `cubic-bezier(0.33, 1, 0.68, 1)`) rather than nearly finishing in the first third of the timeline (the old `cubic-bezier(0.16, 1, 0.3, 1)` behaviour).
  - Toggle `prefers-reduced-motion` (Rendering panel → Emulate CSS media feature): every animation above collapses to ~1ms per the existing rule at `index.css:1225-1236`. Confirm nothing here needed a change to keep that working — it reads `animation-duration`/`transition-duration` generically, not the token names.
- **Done when**: `--dur-view` is 380ms, `--dur-tab` is 420ms, `--dur-focal` is 600ms, every animation listed in Steps 2–8 uses `var(--ease-settle)`, `.nav-player-out` still uses `var(--ease-in)`, and both mechanical checks pass.
