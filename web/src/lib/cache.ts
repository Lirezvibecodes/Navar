import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A read cache for the handful of endpoints a visit asks for again and again.
 *
 * Navigation in this app remounts a screen from scratch — every push bumps
 * `seq.current`, which is the React key of the whole stack — so going Home →
 * Crate → Home builds a second HomeView that knows nothing about the first.
 * Without somewhere to keep the answer, the second one shows a skeleton and
 * pays for another round trip to a server that sleeps after fifteen idle
 * minutes. That is the wake-up cost, twice, for a screen that has not changed.
 *
 * The store therefore lives at module scope, outside React, where a remount
 * cannot reach it. `useCached` reads it *during render*, not in an effect, so
 * a revisited screen paints its rows in the first frame and never flashes a
 * loading state it does not need. If the entry is older than its TTL a
 * revalidate runs in the background and swaps the rows in when it lands —
 * stale-while-revalidate, with the staleness bounded by the TTL and by the
 * invalidation the mutations perform.
 *
 * What this is not: a store. Nothing here is the authority on anything. The
 * library's own rows still live in LibraryContext, which is a cache in its own
 * right and is left alone; this only covers the reads that context does not
 * hold. A failed revalidate keeps whatever was already cached rather than
 * emptying it, because the screen showing week-old rows is better than the
 * screen showing an error over rows it still has.
 */

interface Entry {
  /** Undefined until a fetch has landed at least once. */
  data: unknown;
  fetchedAt: number;
  /** Shared by every caller that arrives while a fetch is out. */
  inflight: Promise<unknown> | null;
}

const store = new Map<string, Entry>();

/**
 * The names entries are filed under, in one place.
 *
 * They are built rather than written out at the call sites so that a read and
 * the invalidation that clears it cannot drift apart — and so the prefixes are
 * a deliberate shape: everything about one playlist starts `playlist:<id>`,
 * so dropping that one string drops all of it.
 */
export const cacheKey = {
  home: "home",
  playlistTracks: (id: string) => `playlist:${id}:tracks`,
  profile: (id: string | number) => `profile:${id}`,
  friends: "friends",
  suggestions: "social:suggestions",
  activity: "social:activity",
  palette: (id: string) => `palette:${id}`,
} as const;

/**
 * How long an answer stays good enough to show without asking again.
 *
 * These are backstops, not the correctness mechanism — a mutation drops the
 * keys it invalidates the moment it happens, so a TTL only governs the things
 * this phone cannot know about: a friend adding a track, somebody accepting a
 * request, an endorsement arriving. They are short where another person can
 * change the answer and long where only you can.
 */
export const ttl = {
  /** What Home shows moves as friends listen; it is also the wake-up call. */
  home: 60_000,
  /** Only you reorder your own playlist, and doing so drops the key anyway. */
  playlistTracks: 300_000,
  /** Badges and endorsements are other people's doing. */
  profile: 60_000,
  friends: 60_000,
  /** The friend graph cannot have moved much between two glances. */
  suggestions: 300_000,
  /** In step with the poll SocialView runs while its tab is on screen. */
  activity: 30_000,
  /** A cover is fixed, so the colours taken from it are too. */
  palette: Infinity,
} as const;

/** What is held for this key right now, without asking for any of it. */
export function peek<T>(key: string): T | undefined {
  return store.get(key)?.data as T | undefined;
}

/** Put a value in without a fetch — for a screen that just mutated its own. */
export function writeCache<T>(key: string, data: T): void {
  store.set(key, { data, fetchedAt: Date.now(), inflight: null });
}

/**
 * Forget everything filed under any of these names or under a name beginning
 * with one. Called by the mutations that make an entry wrong; see the callers
 * in LibraryContext, which is where most of them are.
 */
export function dropCache(...prefixes: string[]): void {
  for (const key of [...store.keys()]) {
    if (prefixes.some((p) => key === p || key.startsWith(p))) store.delete(key);
  }
}

/**
 * Fetch and file the answer, or join the fetch already out for this key.
 *
 * A rejection leaves any previously cached value where it is and only clears
 * the in-flight slot, so the next caller tries again rather than inheriting
 * the failure.
 */
export function revalidate<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const existing = store.get(key);
  if (existing?.inflight) return existing.inflight as Promise<T>;

  const inflight = fetcher().then(
    (data) => {
      store.set(key, { data, fetchedAt: Date.now(), inflight: null });
      return data;
    },
    (err: unknown) => {
      const entry = store.get(key);
      if (entry) entry.inflight = null;
      throw err;
    }
  );

  store.set(key, {
    data: existing?.data,
    fetchedAt: existing?.fetchedAt ?? 0,
    inflight,
  });
  return inflight;
}

/** Cached if fresh, shared if in flight, fetched otherwise. */
export function cached<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number
): Promise<T> {
  const entry = store.get(key);
  if (entry?.inflight) return entry.inflight as Promise<T>;
  if (entry && entry.data !== undefined && Date.now() - entry.fetchedAt < ttlMs) {
    return Promise.resolve(entry.data as T);
  }
  return revalidate(key, fetcher);
}

export interface Cached<T> {
  /** Undefined only while nothing has ever been fetched for this key. */
  data: T | undefined;
  /** True only on a genuine cold read — a cache hit never reports loading. */
  loading: boolean;
  error: Error | null;
  /** Fetch again regardless of the TTL. */
  refresh: () => void;
  /**
   * Replace the value here and in the store, without a fetch.
   *
   * For the optimistic update a screen makes on its own data: writing through
   * rather than into local state is what stops the cache handing the old
   * answer back the next time the screen is opened.
   */
  set: (data: T) => void;
}

/**
 * One cached read, as a hook.
 *
 * `fetcher` is held in a ref rather than depended on, so callers may pass the
 * inline closure that reads most naturally at the call site without it
 * retriggering the fetch on every render. The key is the identity of the read:
 * change it and the hook switches to that entry synchronously, in the same
 * render, so navigating between two playlists never shows the wrong rows.
 */
export function useCached<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttlMs: number
): Cached<T> {
  // Kept current in an effect rather than assigned during render, and
  // declared above the effect that reads it so React runs the two in that
  // order on every commit.
  const run = useRef(fetcher);
  useEffect(() => {
    run.current = fetcher;
  });

  const [state, setState] = useState<{
    key: string;
    data: T | undefined;
    error: Error | null;
  }>(() => ({ key, data: peek<T>(key), error: null }));

  // Adjusted while rendering rather than in an effect: an effect would paint
  // one frame of the old key's rows underneath the new key's header.
  if (state.key !== key) setState({ key, data: peek<T>(key), error: null });

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback((k: string) => {
    revalidate(k, () => run.current()).then(
      (data) => {
        if (!alive.current) return;
        // Guarded on the key so a slow answer for a screen already navigated
        // away from cannot land on the one that replaced it.
        setState((prev) => (prev.key === k ? { key: k, data, error: null } : prev));
      },
      (err: unknown) => {
        if (!alive.current) return;
        // Keep what is on screen. Only a read that has never landed shows the
        // error, because only that one has nothing else to show.
        setState((prev) =>
          prev.key === k
            ? {
                ...prev,
                error: err instanceof Error ? err : new Error("Request failed"),
              }
            : prev
        );
      }
    );
  }, []);

  useEffect(() => {
    const entry = store.get(key);
    const fresh =
      entry != null &&
      entry.data !== undefined &&
      Date.now() - entry.fetchedAt < ttlMs;
    // A fresh entry was already returned by the render above.
    if (!fresh) load(key);
  }, [key, ttlMs, load]);

  const refresh = useCallback(() => load(key), [key, load]);

  const set = useCallback(
    (data: T) => {
      writeCache(key, data);
      setState({ key, data, error: null });
    },
    [key]
  );

  return {
    data: state.data,
    loading: state.data === undefined && state.error === null,
    error: state.error,
    refresh,
    set,
  };
}
