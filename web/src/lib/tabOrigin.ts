/**
 * Where the tab you just tapped actually sits, so the screen that replaces
 * the content can grow out of it instead of sliding in from a fixed edge.
 *
 * BottomNav stashes the tapped button's horizontal centre here, right before
 * calling onSelect; Shell reads it once, when it applies the "tab" transition
 * to the incoming screen. Same shape as lib/focal.ts's origin — a module-level
 * value written from a real bounding box rather than a hardcoded position —
 * just for a horizontal point instead of a whole rect.
 */

let originX: string | null = null;

/** Called by BottomNav's onClick, before onSelect. */
export function setTabOrigin(el: HTMLElement | null): void {
  if (!el) {
    originX = null;
    return;
  }
  const rect = el.getBoundingClientRect();
  originX = `${Math.round(rect.left + rect.width / 2)}px`;
}

/** Read once by Shell when it renders the incoming screen. */
export function tabOriginX(): string | null {
  return originX;
}
