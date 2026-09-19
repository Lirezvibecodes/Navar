import { useState } from "react";

/**
 * A choice a screen would otherwise forget on the remount every push and pop
 * performs — which chip is selected, which sort order is showing — kept in a
 * module-level store keyed by a caller-chosen name rather than tied to any
 * one component instance, the same way `Screen`'s `scrollKey` (see
 * components/ui.tsx) remembers scroll position across that same remount.
 * This is for everything else a screen shows about itself beyond its data.
 *
 * `restoring` decides whether the store or `initial` wins on this mount, for
 * screens that can also be reached with a fresh, explicit choice — a filter
 * pushed onto them — that has to win over whatever was left here on a
 * previous visit. Pass `nav.direction === "pop"` for those; leave it at its
 * default of `true` for a screen with no such incoming intent, where
 * whatever was left is simply what should still be there, the same as a
 * remembered scroll position. Either way, this mount's winning value is
 * written back to the store immediately, so a push or a tab switch that
 * loses to `initial` does not leave a stale value for the next pop to find.
 */
const store = new Map<string, unknown>();

export function usePersistedState<T>(
  key: string,
  initial: T,
  restoring = true
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const next = restoring && store.has(key) ? (store.get(key) as T) : initial;
    store.set(key, next);
    return next;
  });
  const set = (next: T) => {
    store.set(key, next);
    setValue(next);
  };
  return [value, set];
}
