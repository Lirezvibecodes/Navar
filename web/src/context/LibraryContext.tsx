import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import * as api from "../api";
import type { Me, Playlist, Track } from "../types";

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
  tracks: Track[];
  playlists: Playlist[];
  loading: boolean;
  error: string | null;

  reload: () => Promise<void>;
  /** Replaces one row everywhere it is held. */
  putTrack: (track: Track) => void;
  /** Drops rows from local state; the caller has already told the server. */
  dropTracks: (ids: string[]) => void;
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
  children,
}: {
  me: Me | null;
  children: React.ReactNode;
}) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!me) return;
    setError(null);
    try {
      const [t, p] = await Promise.all([api.listTracks(), api.listPlaylists()]);
      setTracks(t);
      setPlaylists(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your library");
    } finally {
      setLoading(false);
    }
  }, [me]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const putTrack = useCallback((track: Track) => {
    setTracks((rows) => rows.map((t) => (t.id === track.id ? track : t)));
  }, []);

  const dropTracks = useCallback((ids: string[]) => {
    const gone = new Set(ids);
    setTracks((rows) => rows.filter((t) => !gone.has(t.id)));
  }, []);

  const putPlaylist = useCallback((playlist: Playlist) => {
    setPlaylists((rows) => {
      const exists = rows.some((p) => p.id === playlist.id);
      return exists
        ? rows.map((p) => (p.id === playlist.id ? playlist : p))
        : [...rows, playlist];
    });
  }, []);

  const dropPlaylist = useCallback((id: string) => {
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
      tracks,
      playlists,
      loading,
      error,
      reload,
      putTrack,
      dropTracks,
      putPlaylist,
      dropPlaylist,
      setFavorite,
      owns,
    }),
    [
      me,
      tracks,
      playlists,
      loading,
      error,
      reload,
      putTrack,
      dropTracks,
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

export function albumsOf(tracks: Track[]): Grouped[] {
  return groupBy(tracks, (t) => t.album);
}

export function artistsOf(tracks: Track[]): Grouped[] {
  return groupBy(tracks, (t) => t.artist);
}
