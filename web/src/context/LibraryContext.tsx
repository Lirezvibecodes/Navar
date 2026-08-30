import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import * as api from "../api";
import { cacheKey, dropCache } from "../lib/cache";
import { splitArtists } from "../lib/artists";
import type { FriendPlaylist, Me, Playlist, Track } from "../types";

/**
 * Everything the app knows about your own music, loaded once.
 *
 * A Telegram library is a few hundred rows at most and the server sleeps after
 * fifteen idle minutes, so one round trip at open and none after it is both
 * cheaper and faster than fetching per screen: Home, Library, The Crate and
 * every album and artist page are all views over the same two arrays. It also
 * means a heart or a rename shows everywhere at once, because there is only
 * one copy of the row to update.
 *
 * Mutations are optimistic and reconciled with what the server returns. The
 * server is the authority on the row — it decides the favourite timestamp, it
 * trims the tags — but waiting for a round trip before filling in a heart is
 * the kind of lag that makes a phone feel broken.
 */

interface LibraryApi {
  me: Me | null;
  /**
   * Replaces the signed-in identity. Only the handle can change while a session
   * is open, and it changes from a view rather than from here, so the state
   * lives where the session does and the setter comes down to meet it.
   */
  setMe: (me: Me) => void;
  tracks: Track[];
  playlists: Playlist[];
  /** Other people's playlists this person has saved — kept live by reference, never copied. */
  followedPlaylists: FriendPlaylist[];
  loading: boolean;
  error: string | null;

  reload: () => Promise<void>;
  follow: (playlistId: string) => Promise<void>;
  unfollow: (playlistId: string) => Promise<void>;
  /** Replaces one row everywhere it is held. */
  putTrack: (track: Track) => void;
  /** Drops rows from local state; the caller has already told the server. */
  dropTracks: (ids: string[]) => void;
  /**
   * Records that these tracks now sit in at least one playlist.
   *
   * `in_playlist` is what the Crate's All/Unsorted split reads, and it is
   * computed by the server on the library listing — so adding a track to a
   * playlist used to leave it sitting in Unsorted until the next reload, which
   * is the opposite of what the screen is for. Only the true direction is
   * offered: this client cannot know whether removing a track from one playlist
   * has taken it out of every playlist, and guessing would file a track back
   * under Unsorted while it is still in two others.
   */
  markInPlaylist: (ids: string[]) => void;
  putPlaylist: (playlist: Playlist) => void;
  dropPlaylist: (id: string) => void;

  setFavorite: (track: Track, on: boolean) => Promise<void>;
  /** True when this row is yours to edit, heart or delete. */
  owns: (track: Track) => boolean;
}

const Ctx = createContext<LibraryApi | null>(null);

export function useLibrary(): LibraryApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useLibrary outside LibraryProvider");
  return ctx;
}

export function LibraryProvider({
  me,
  setMe,
  children,
}: {
  me: Me | null;
  setMe: (me: Me) => void;
  children: React.ReactNode;
}) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [followedPlaylists, setFollowedPlaylists] = useState<FriendPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!me) return;
    setError(null);
    try {
      const [t, p, f] = await Promise.all([
        api.listTracks(),
        api.listPlaylists(),
        api.listFollowedPlaylists(),
      ]);
      setTracks(t);
      setPlaylists(p);
      setFollowedPlaylists(f);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your library");
    } finally {
      setLoading(false);
    }
  }, [me]);

  // Optimistic on the way out — dropping a followed playlist you have just
  // opened should not wait on a round trip to disappear from your library —
  // and reconciled with the server's own list on the way in, since a follow
  // needs the owner's name and cover, which this client does not otherwise have.
  const follow = useCallback(async (playlistId: string) => {
    await api.followPlaylist(playlistId);
    dropCache(cacheKey.home);
    setFollowedPlaylists(await api.listFollowedPlaylists());
  }, []);

  const unfollow = useCallback(async (playlistId: string) => {
    setFollowedPlaylists((rows) => rows.filter((p) => p.id !== playlistId));
    dropCache(cacheKey.home);
    await api.unfollowPlaylist(playlistId);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /**
   * What the cached reads elsewhere in the app hold that this mutation makes
   * wrong.
   *
   * These live here because this is where the app's writes already funnel:
   * every heart, rename, delete and playlist change passes through one of the
   * callbacks below, so the invalidation cannot be forgotten at a call site.
   * `setFavorite` needs no case of its own — it does its work through
   * `putTrack` twice, and inherits its drop both times.
   */

  // Replace, or put in front if it is new — the same shape as putPlaylist. The
  // library is ordered newest first, so a track arriving here for the first
  // time (a save from a friend's playlist) belongs at the top, where the
  // reload it eventually gets would put it anyway.
  const putTrack = useCallback((track: Track) => {
    // A retitled or newly hearted row is quoted by Home's shelves and sits
    // inside whatever playlists hold it.
    dropCache(cacheKey.home, "playlist:");
    setTracks((rows) =>
      rows.some((t) => t.id === track.id)
        ? rows.map((t) => (t.id === track.id ? track : t))
        : [track, ...rows]
    );
  }, []);

  const dropTracks = useCallback((ids: string[]) => {
    // Also the profile counts, which are the one thing a deletion changes that
    // a retitle does not.
    dropCache(cacheKey.home, "playlist:", "profile:", cacheKey.activity);
    const gone = new Set(ids);
    setTracks((rows) => rows.filter((t) => !gone.has(t.id)));
  }, []);

  const markInPlaylist = useCallback((ids: string[]) => {
    dropCache(cacheKey.home, "playlist:");
    const filed = new Set(ids);
    setTracks((rows) =>
      rows.map((t) => (filed.has(t.id) ? { ...t, in_playlist: true } : t))
    );
  }, []);

  const putPlaylist = useCallback((playlist: Playlist) => {
    // Home draws playlist cards and a profile counts them; the rows inside are
    // untouched by a rename or a change of cover, so that key stays.
    dropCache(cacheKey.home, "profile:");
    setPlaylists((rows) => {
      const exists = rows.some((p) => p.id === playlist.id);
      return exists
        ? rows.map((p) => (p.id === playlist.id ? playlist : p))
        : [...rows, playlist];
    });
  }, []);

  const dropPlaylist = useCallback((id: string) => {
    dropCache(cacheKey.home, "profile:", `playlist:${id}`);
    setPlaylists((rows) => rows.filter((p) => p.id !== id));
  }, []);

  const owns = useCallback(
    (track: Track) => me != null && String(track.owner_telegram_id) === String(me.id),
    [me]
  );

  const setFavorite = useCallback(
    async (track: Track, on: boolean) => {
      const before = track;
      // Optimistic, with a plausible timestamp so any "recently favourited"
      // ordering does not jump when the real one arrives.
      putTrack({ ...track, favorited_at: on ? new Date().toISOString() : null });
      try {
        putTrack(await api.updateTrack(track.id, { favorited: on }));
      } catch {
        putTrack(before);
      }
    },
    [putTrack]
  );

  const value = useMemo<LibraryApi>(
    () => ({
      me,
      setMe,
      tracks,
      playlists,
      followedPlaylists,
      loading,
      error,
      reload,
      follow,
      unfollow,
      putTrack,
      dropTracks,
      markInPlaylist,
      putPlaylist,
      dropPlaylist,
      setFavorite,
      owns,
    }),
    [
      me,
      setMe,
      tracks,
      playlists,
      followedPlaylists,
      loading,
      error,
      reload,
      follow,
      unfollow,
      putTrack,
      dropTracks,
      markInPlaylist,
      putPlaylist,
      dropPlaylist,
      setFavorite,
      owns,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// --- Derivations -------------------------------------------------------------
//
// The album and artist listings the server exposes as their own endpoints are
// the same GROUP BY the client can do over rows it already holds, so on your
// own library they are computed here and the endpoints are left for the pages
// that browse somebody else's.

export interface Grouped {
  name: string;
  track_count: number;
  cover_track_id: string | null;
}

function groupBy(tracks: Track[], key: (t: Track) => string | null): Grouped[] {
  const groups = new Map<string, Grouped>();
  for (const track of tracks) {
    const name = key(track)?.trim();
    if (!name) continue;
    const existing = groups.get(name);
    if (existing) {
      existing.track_count += 1;
      existing.cover_track_id ??= track.has_cover ? track.id : null;
    } else {
      groups.set(name, {
        name,
        track_count: 1,
        cover_track_id: track.has_cover ? track.id : null,
      });
    }
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * An album needs more than one track to be worth a shelf of its own — a
 * single-track "album" is indistinguishable from a single that happened to
 * carry an album tag.
 */
export function albumsOf(tracks: Track[]): Grouped[] {
  return groupBy(tracks, (t) => t.album).filter((g) => g.track_count > 1);
}

export function artistsOf(tracks: Track[]): Grouped[] {
  const groups = new Map<string, Grouped>();
  for (const track of tracks) {
    if (!track.artist) continue;
    for (const name of splitArtists(track.artist)) {
      const existing = groups.get(name);
      if (existing) {
        existing.track_count += 1;
        existing.cover_track_id ??= track.has_cover ? track.id : null;
      } else {
        groups.set(name, {
          name,
          track_count: 1,
          cover_track_id: track.has_cover ? track.id : null,
        });
      }
    }
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}
