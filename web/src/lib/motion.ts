/**
 * What CSS already knows about motion, made available to the code that
 * animates without CSS.
 *
 * The reduced-motion block in index.css collapses every transition and
 * keyframe in the app, but it cannot reach a scroll that JavaScript asked for
 * by name: `scrollTo({ behavior: "smooth" })` overrides the `scroll-behavior`
 * property outright. So the two places that scroll something into view ask
 * here instead of hardcoding "smooth".
 */

/** True when the person has asked their phone to stop animating things. */
export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The behaviour to hand a scroll call: gliding for most people, instant for
 * anyone who finds that unpleasant or nauseating.
 */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}
