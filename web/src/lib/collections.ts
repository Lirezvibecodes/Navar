import { useSyncExternalStore } from "react";

/**
 * Which songs each playlist, album and Favourites held the last time its
 * screen was open, kept on the device.
 *
 * The library grid knows a playlist's name and count but not its songs, and
 * fetching every playlist to draw a download mark on its tile would cost a
 * request per tile, offline included. So each track list writes down what it
 * showed (TrackListScreen), and a tile reads that back. A playlist that has
 * changed since shows as partly downloaded until it is opened again, which is
 * also when its header offers to fetch the rest.
 *
 * Keys are TrackListScreen's own sourceKeys: `playlist:<id>`, `album:<name>`,
 * `favorites`.
 */

const STORE_KEY = "navaar-collections";
let collections: Record<string, string[]> = read();
const listeners = new Set<() => void>();

function read(): Record<string, string[]> {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}") as Record<string, string[]>;
  } catch {
    return {};
  }
}

export function rememberCollection(key: string, trackIds: string[]): void {
  const previous = collections[key];
  if (previous && previous.length === trackIds.length && previous.every((id, i) => id === trackIds[i])) return;
  collections = { ...collections, [key]: trackIds };
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(collections));
  } catch {
    // Kept for this session only.
  }
  listeners.forEach((l) => l());
}

const EMPTY: string[] = [];

/** The songs a collection held when last seen, or an empty list if never. */
export function useCollectionTracks(key: string): string[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => collections[key] ?? EMPTY
  );
}

export function forgetCollections(): void {
  collections = {};
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    // Nothing to forget.
  }
  listeners.forEach((l) => l());
}
