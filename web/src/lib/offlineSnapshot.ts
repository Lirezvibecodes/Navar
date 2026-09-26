import type { FriendPlaylist, Me, Playlist, Track } from "../types";

/**
 * The last library this phone saw, kept so the app can still open when the
 * server cannot be reached — asleep, down, or behind a connection too weak to
 * get an answer out of it.
 *
 * It is only ever a stand-in. A live sign-in always wins and overwrites it;
 * this is read when that sign-in has failed on the network, never instead of
 * trying. Opened this way the app shows what you had and plays what the song
 * cache (audioCache.ts) holds; anything that needs the server says so when it
 * is tried.
 *
 * localStorage rather than IndexedDB because Boot and LibraryProvider need it
 * synchronously, in their first render. Every access is guarded: a full or
 * disabled store just means there is no snapshot.
 */

const ME_KEY = "navaar-offline-me";
const LIBRARY_KEY = "navaar-offline-library";

export interface LibrarySnapshot {
  tracks: Track[];
  playlists: Playlist[];
  followedPlaylists: FriendPlaylist[];
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Out of room: the previous snapshot, if any, stays.
  }
}

export function saveMeSnapshot(me: Me): void {
  write(ME_KEY, me);
}

export function saveLibrarySnapshot(library: LibrarySnapshot): void {
  write(LIBRARY_KEY, library);
}

export function readLibrarySnapshot(): LibrarySnapshot | null {
  return read<LibrarySnapshot>(LIBRARY_KEY);
}

/**
 * The saved account, but only if it belongs to whoever Telegram says is
 * opening the app now. Telegram's storage for a Mini App is not always split
 * by account, and nobody should open the app to someone else's library.
 */
export function readMeSnapshot(initData: string | undefined): Me | null {
  const me = read<Me>(ME_KEY);
  if (!me || !initData) return null;
  try {
    const user = JSON.parse(new URLSearchParams(initData).get("user") ?? "null") as { id?: number } | null;
    return user?.id === me.id ? me : null;
  } catch {
    return null;
  }
}

/** A fetch that never reached the server, as opposed to one it refused. */
export function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError || (typeof navigator !== "undefined" && navigator.onLine === false);
}
