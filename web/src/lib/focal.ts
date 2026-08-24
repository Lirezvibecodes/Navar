/**
 * The one authored transition in the app: the Now Playing bar becoming the
 * full player.
 *
 * The bar registers its artwork element here. When the player opens it asks
 * for that element's live bounding box and works out the translate and scale
 * that would put the hero square exactly on top of the little round disc, then
 * lets CSS animate from there to nothing. Nothing about the geometry is
 * hardcoded, so it stays correct at every screen size and when Telegram
 * changes the safe-area inset underneath us.
 *
 * If the bar was never on screen — the player was opened from a track row —
 * there is no origin and the caller simply skips the class, leaving the
 * ordinary view push.
 */

let originEl: HTMLElement | null = null;

/** Ref callback for the artwork inside the Now Playing bar. */
export function setFocalOrigin(el: HTMLElement | null): void {
  originEl = el;
}

export function focalOriginRect(): DOMRect | null {
  if (!originEl || !originEl.isConnected) return null;
  const rect = originEl.getBoundingClientRect();
  return rect.width > 0 ? rect : null;
}

/**
 * Writes --nav-art-dx / -dy / -scale onto the player's artwork so the
 * nav-art-in keyframe starts from where the bar's disc is right now.
 * Returns false when there is no origin to grow from.
 */
export function applyFocalGrow(target: HTMLElement | null): boolean {
  const from = focalOriginRect();
  if (!from || !target) return false;

  const to = target.getBoundingClientRect();
  if (to.width === 0) return false;

  const scale = from.width / to.width;
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);

  target.style.setProperty("--nav-art-dx", `${Math.round(dx)}px`);
  target.style.setProperty("--nav-art-dy", `${Math.round(dy)}px`);
  target.style.setProperty("--nav-art-scale", scale.toFixed(3));
  return true;
}

/**
 * The vertical distance the player screen itself rises through, measured from
 * the bar rather than assumed, so the sheet appears to come up from the bar
 * and not from the bottom of an imaginary window.
 */
export function focalRiseVars(): Record<string, string> {
  const from = focalOriginRect();
  if (!from) return {};
  return { "--nav-focal-dy": `${Math.round(from.top)}px` };
}
