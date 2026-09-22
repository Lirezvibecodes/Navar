# Animation plans

Findings from an `improve-animations` audit, scoped to the user's explicit ask:
slower, smoother, more satisfying motion, especially page switches and the
mini-player → full-player transition. The rest of the app's motion (press
feedback, toggles, sheets, list gestures) was audited and found already
correct against [AUDIT.md](../../.claude/skills/improve-animations/AUDIT.md) —
see "Audited and left alone" below for what was deliberately not touched, and
why.

| # | Title | Severity | Category | Status |
| --- | --- | --- | --- | --- |
| [001](001-slow-and-smooth-view-level-motion.md) | Slow down view/tab/focal transitions and move them onto `--ease-settle` | HIGH | Easing & duration / Cohesion & tokens | DONE |
| [002](002-choreograph-focal-player-close-and-art-settle.md) | Make the artwork settle a beat early, and let a dragged-away close match the slower open | MEDIUM | Cohesion & tokens / Interruptibility | DONE |

## Execution order

**001 first, then 002.** Plan 002 edits the same `.nav-art-in` rule that 001
retunes (the easing swap), and its Part B depends on 001's new `--dur-focal`
value to compute the updated `PLAYER_OUT_MS` constant. Applying 002 alone,
before 001, is possible (002's Boundaries section says what to use instead)
but produces an intermediate state that 001 will immediately change again —
there's no reason to do it in that order.

## What these plans change, in one paragraph each

**001** raises three duration tokens in `web/src/index.css`'s `:root` block —
`--dur-view` 300ms→380ms (push/pop between screens), `--dur-tab` 340ms→420ms
(switching bottom-nav tabs), `--dur-focal` 460ms→600ms (mini player growing
into the full player) — and swaps the entrance easing on every rule driven by
those tokens from `--ease` to the already-defined `--ease-settle` curve, which
is stronger and more decisive without being bouncy. Press/hover/toggle
feedback (`--dur-tap`, `--dur-state`) and every exit animation (`--ease-in`)
are explicitly left untouched, because slowing those would make the app feel
laggy rather than satisfying — the opposite of the ask.

**002** fixes two small drifts between what the code's own comments say should
happen and what it actually does. The artwork inside the full player is
documented as settling "a beat before the rest of the screen," but it
currently runs on the exact same clock as the sheet around it — this plan
gives it a shorter, derived duration so it actually lands first. Separately,
dragging the player down to dismiss it currently snaps closed in 200ms while
tapping the chevron to close takes more than twice as long once 001 lands —
the same action, closing the same screen, feeling like two different speeds
depending on which affordance triggered it. This plan gives the drag-dismiss
outcome its own transition class, matching the chevron close's timing exactly.

## Audited and left alone

- **Press/hover/state feedback** (`--dur-tap` 90ms, `--dur-state` 200ms) —
  already fast, already `ease-out`-family, already used consistently. Per
  `AUDIT.md` §1 and §4, high-frequency system responses should snap, not
  slow down; touching these would work against "satisfying."
- **`prefers-reduced-motion` handling** — a single, comprehensive rule already
  collapses all `animation-duration`/`transition-duration` app-wide
  (`index.css` reduced-motion block). Nothing in 001 or 002 needs a
  reduced-motion-specific carve-out because both only change duration/easing
  values that block already controls.
- **Physicality** — no `scale(0)` anywhere; entrances already use
  `scale(0.9–0.97)`-range transforms with real, measured or dynamic transform
  origins (`tabOrigin.ts`, `focal.ts`), not hardcoded geometry or center
  scaling. Nothing to fix.
- **Generic bottom sheet** (`Sheet` in `web/src/components/ui.tsx`) — already
  follows the drawer pattern correctly: `translateY(100%)` exit, `--ease-in`
  on close, `--dur-state` timing, a `SHEET_EXIT_MS` constant kept in sync with
  the CSS the same way `PLAYER_OUT_MS` is. Not part of the user's stated focus
  (page switches, mini↔full player) and not broken, so left alone.
- **Pane crossfade inside the full player** (`.nav-fade` on tab switches
  within the player) — a plain opacity crossfade with no blur mask. This is a
  real, minor "missed opportunity" (`AUDIT.md` §7's blur-masked-crossfade
  guidance would apply) but it's cosmetic polish, not part of what the user
  called out, and not planned in this round.
- **Distance-only drag dismissal** (the player's drag-to-close, plus
  `useSwipeQueue`/`useSwipeRemove` elsewhere) — `AUDIT.md` §4 flags
  distance-only thresholds as a finding; velocity-based release
  (`Math.abs(distance)/elapsedMs > ~0.11`) would feel better on a fast flick.
  This is a real gap but a gesture-recognition rewrite across three handlers,
  not a timing change, and outside the user's stated focus on transition
  speed/smoothness — left as a known, deferred finding rather than planned.
