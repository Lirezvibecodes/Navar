/**
 * Taking down the first-frame splash in index.html.
 *
 * The splash is inline markup rather than a component, because its whole
 * purpose is to be on screen before the bundle exists (see index.html). That
 * leaves the question of who removes it, and the answer cannot be "whoever
 * mounts first": mounting only means React has something to draw, and what it
 * draws until authentication resolves is nothing. Cutting to an empty screen
 * and then to the app is the blank-blank-app sequence the splash was added to
 * replace.
 *
 * So the app calls this, once, at the moment it has something real to show —
 * the signed-in shell, the name screen, a sign-in error, or the shared-playlist
 * page. It lives here rather than in main.tsx so that neither of those has to
 * import the other.
 */

/** Long enough that a warm start reads as a beat rather than as a flicker. */
const MIN_VISIBLE_MS = 450;

/** Kept in step with the transition on #boot in index.html. */
const FADE_MS = 300;

const shownAt = performance.now();
let dismissed = false;

export function hideSplash(): void {
  if (dismissed) return;
  dismissed = true;

  const el = document.getElementById("boot");
  if (!el) return;

  const remaining = Math.max(0, MIN_VISIBLE_MS - (performance.now() - shownAt));
  window.setTimeout(() => {
    el.dataset.leaving = "true";
    // Removed rather than left faded out: it covers the whole viewport, and an
    // invisible full-screen layer over the app eats every tap.
    window.setTimeout(() => el.remove(), FADE_MS);
  }, remaining);
}
