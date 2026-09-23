import { useEffect, useMemo, useRef, useState } from "react";
import * as api from "../api";
import type { Navigation } from "../App";
import { CollectionArt } from "../components/PixelArt";
import { TrackMenu } from "../components/TrackMenu";
import type { TrackMenuTarget } from "../components/TrackMenu";
import { TrackRow } from "../components/TrackRow";
import { Counted, Empty, GhostButton, Screen, SectionHeader, TextField } from "../components/ui";
import { albumsOf, artistsOf, useLibrary } from "../context/LibraryContext";
import { usePlayer } from "../context/PlayerContext";
import { CloseIcon } from "../icons";
import { personName, trackArtist, trackTitle } from "../lib/format";
import { haptic } from "../telegram";

/**
 * One field, four categories. Every screen that has a search icon sends you
 * here rather than to a search scoped to wherever you tapped it from, since
 * a track can live in a playlist, an album and an artist all at once — a
 * search boxed into one of those would just be the wrong three-quarters of
 * the answer.
 *
 * Everything searched is already in memory — the same tracks and playlists
 * LibraryContext holds for the rest of the app — so filtering as you type
 * costs nothing and works even while the server is asleep.
 */
export function SearchView({ nav }: { nav: Navigation }) {
  const { tracks, owns, playlists, followedPlaylists, setFavorite } = useLibrary();
  const { current, isPlaying, playFrom, queueNext, queueLast } = usePlayer();
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<TrackMenuTarget | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const q = query.trim().toLowerCase();

  const matchedTracks = useMemo(() => {
    if (!q) return [];
    return tracks.filter(
      (t) =>
        trackTitle(t).toLowerCase().includes(q) ||
        trackArtist(t).toLowerCase().includes(q) ||
        (t.album ?? "").toLowerCase().includes(q)
    );
  }, [tracks, q]);

  const matchedOwnPlaylists = useMemo(
    () => (q ? playlists.filter((p) => p.name.toLowerCase().includes(q)) : []),
    [playlists, q]
  );
  const matchedFriendPlaylists = useMemo(
    () => (q ? followedPlaylists.filter((p) => p.name.toLowerCase().includes(q)) : []),
    [followedPlaylists, q]
  );
  const matchedAlbums = useMemo(
    () => (q ? albumsOf(tracks).filter((a) => a.name.toLowerCase().includes(q)) : []),
    [tracks, q]
  );
  const matchedArtists = useMemo(
    () => (q ? artistsOf(tracks).filter((a) => a.name.toLowerCase().includes(q)) : []),
    [tracks, q]
  );

  const nothing =
    q.length > 0 &&
    matchedTracks.length === 0 &&
    matchedOwnPlaylists.length === 0 &&
    matchedFriendPlaylists.length === 0 &&
    matchedAlbums.length === 0 &&
    matchedArtists.length === 0;

  const source = useMemo(
    () => ({ label: "Search", key: `search:${q}`, tracks: matchedTracks }),
    [q, matchedTracks]
  );

  return (
    <Screen scrollKey="search">
      <div
        className="nav-rise"
        style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}
      >
        <TextField
          ref={inputRef}
          value={query}
          onChange={setQuery}
          placeholder="Search your library"
          height={38}
          autoCorrect={false}
        />
        <GhostButton icon={CloseIcon} label="Close search" width={44} onClick={() => nav.pop()} />
      </div>

      {!q ? (
        <Empty title="Search your library" body="Find a track, playlist, album or artist." />
      ) : nothing ? (
        <Empty
          title="Nothing matched"
          body="Try part of a title, artist, album or playlist name."
        />
      ) : (
        <>
          {matchedTracks.length > 0 ? (
            <>
              <SectionHeader title="Tracks" spaceAbove={22} />
              {matchedTracks.map((track, i) => (
                <TrackRow
                  key={track.id}
                  track={track}
                  index={i}
                  playing={current?.id === track.id && isPlaying}
                  owned={owns(track)}
                  favorited={track.favorited_at != null}
                  query={query}
                  onPlay={() => playFrom(source, track)}
                  onMenu={() => setMenu({ track })}
                  onToggleFavorite={() =>
                    void setFavorite(track, track.favorited_at == null)
                  }
                  onQueueNext={() => queueNext(track)}
                  onQueueLast={() => queueLast(track)}
                />
              ))}
            </>
          ) : null}

          {matchedOwnPlaylists.length > 0 || matchedFriendPlaylists.length > 0 ? (
            <>
              <SectionHeader title="Playlists" spaceAbove={22} />
              {matchedOwnPlaylists.map((p) => (
                <CollectionRow
                  key={p.id}
                  name={p.name}
                  cover={p.cover_track_id}
                  art={api.playlistArtworkUrl(p)}
                  caption={<Counted count={p.track_count ?? 0} one="track" />}
                  onPress={() => nav.push({ type: "playlist", id: p.id, name: p.name })}
                />
              ))}
              {matchedFriendPlaylists.map((p) => (
                <CollectionRow
                  key={p.id}
                  name={p.name}
                  cover={p.cover_track_id}
                  art={api.playlistArtworkUrl(p)}
                  caption={personName(p.person)}
                  onPress={() => nav.push({ type: "playlist", id: p.id, name: p.name })}
                />
              ))}
            </>
          ) : null}

          {matchedAlbums.length > 0 ? (
            <>
              <SectionHeader title="Albums" spaceAbove={22} />
              {matchedAlbums.map((a) => (
                <CollectionRow
                  key={a.name}
                  name={a.name}
                  cover={a.cover_track_id}
                  caption={a.artist || <Counted count={a.track_count} one="track" />}
                  onPress={() => nav.push({ type: "album", name: a.name })}
                />
              ))}
            </>
          ) : null}

          {matchedArtists.length > 0 ? (
            <>
              <SectionHeader title="Artists" spaceAbove={22} />
              {matchedArtists.map((a) => (
                <CollectionRow
                  key={a.name}
                  name={a.name}
                  cover={a.cover_track_id}
                  round
                  caption={<Counted count={a.track_count} one="track" />}
                  onPress={() => nav.push({ type: "artist", name: a.name })}
                />
              ))}
            </>
          ) : null}
        </>
      )}

      <TrackMenu target={menu} onClose={() => setMenu(null)} onGoTo={(to) => nav.push(to)} />
    </Screen>
  );
}

/** A search hit that isn't a track: a playlist, an album or an artist, shown as one row. */
function CollectionRow({
  name,
  cover,
  art,
  round,
  caption,
  onPress,
}: {
  name: string;
  cover?: string | null;
  art?: string | null;
  round?: boolean;
  caption: React.ReactNode;
  onPress: () => void;
}) {
  return (
    <button
      className="nav-press nav-row-in"
      onClick={() => {
        haptic.tap();
        onPress();
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 11,
        width: "100%",
        height: 52,
        textAlign: "left",
      }}
    >
      <CollectionArt
        name={name}
        coverTrackId={cover}
        src={art}
        size={40}
        radius={round ? 20 : 9}
        round={round}
      />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          className="nav-clip"
          style={{ display: "block", fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em" }}
        >
          {name}
        </span>
        <span
          className="nav-clip"
          style={{ display: "block", fontSize: 11.5, color: "var(--color-nav-muted)", marginTop: 1 }}
        >
          {caption}
        </span>
      </span>
    </button>
  );
}
