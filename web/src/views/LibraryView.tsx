import { useLayoutEffect, useMemo, useRef, useState } from "react";
import * as api from "../api";
import type { Navigation } from "../App";
import { CollectionArt } from "../components/PixelArt";
import { NameSheet } from "../components/NameSheet";
import { CrateSection } from "../components/CrateSection";
import {
  Chip,
  ChipRow,
  Counted,
  Empty,
  Screen,
  SectionHeader,
  Skeleton,
  SubBar,
} from "../components/ui";
import {
  albumsOf,
  artistsOf,
  useLibrary,
  type Grouped,
} from "../context/LibraryContext";
import { useToast } from "../context/ToastContext";
import { personName } from "../lib/format";
import { CrateIcon } from "../icons";
import { useFavoritesArt } from "../lib/favoritesArt";
import { haptic } from "../telegram";
import { usePersistedState } from "../lib/persist";
import type { CrateFilter, View } from "../view";

type PlaylistFilter = "you" | "friends" | null;

type Tab = "playlists" | "albums" | "artists" | "crate";

/**
 * Where your music is kept.
 *
 * Playlists, albums and artists are three views onto the same rows; the Crate
 * is a fourth tab rather than a destination, since "everything you own" reads
 * as a cut of the library, not a place outside it. Albums and artists are
 * grouped from tracks already in memory rather than fetched — the server has
 * endpoints for both, and they are what the pages for somebody else's library
 * use.
 *
 * `openCrate` is launch intent carried on the push itself (Home's "unsorted"
 * nudge) rather than a live signal, since by the time it fires this screen
 * may not be mounted yet. A push that carries it wins over whatever tab was
 * showing last; a plain tab reselect or a pop restores it instead — see the
 * `restoring` argument on each `usePersistedState` below.
 */
export function LibraryView({
  nav,
  openCrate,
}: {
  nav: Navigation;
  openCrate?: CrateFilter;
}) {
  const { me, tracks, playlists, followedPlaylists, loading, putPlaylist } = useLibrary();
  const { errorToast } = useToast();

  const [tab, setTab] = usePersistedState<Tab>(
    "library:tab",
    openCrate != null ? "crate" : "playlists",
    nav.direction === "pop" || openCrate == null
  );
  // The Crate's own cut lives here rather than inside CrateSection, since a
  // tap on the pinned Favourites tile below has to set it without a
  // navigation to hang the intent on.
  const [crateSub, setCrateSub] = usePersistedState<CrateFilter>(
    "library:crateSub",
    openCrate ?? "all",
    nav.direction === "pop" || openCrate == null
  );
  // You or friends, never both — a chip toggles itself back off rather than
  // onto the other, since "both" already has its own state: neither chosen.
  const [playlistFilter, setPlaylistFilter] = useState<PlaylistFilter>(null);
  const [naming, setNaming] = useState(false);

  const albums = useMemo(() => albumsOf(tracks), [tracks]);
  const artists = useMemo(() => artistsOf(tracks), [tracks]);
  const favorites = useMemo(
    () => tracks.filter((t) => t.favorited_at != null).length,
    [tracks]
  );
  const favoritesArt = useFavoritesArt(me?.id ?? null);

  // The Playlists subbar starts under "Playlists" itself rather than under the
  // top bar's own left edge, so it reads as that chip's filter rather than a
  // second, disconnected row. Measured off "The Crate" instead of hard-coded,
  // since its width is its icon plus its label plus the row's own padding —
  // three things nobody wants to keep a magic number in sync with by hand.
  const crateChipRef = useRef<HTMLButtonElement>(null);
  const [playlistsInset, setPlaylistsInset] = useState(0);
  useLayoutEffect(() => {
    if (crateChipRef.current) setPlaylistsInset(crateChipRef.current.offsetWidth + 7);
  }, []);

  const newPlaylist = async (name: string) => {
    try {
      const playlist = await api.createPlaylist(name);
      putPlaylist(playlist);
      haptic.success();
      nav.push({ type: "playlist", id: playlist.id, name: playlist.name });
    } catch (err) {
      errorToast(err, "Could not make that playlist");
    }
  };

  if (loading) {
    return (
      <Screen>
        <Skeleton />
      </Screen>
    );
  }

  // Neither chip chosen shows both — the mixed version — rather than nothing,
  // since a filter that can select itself into an empty screen is a trap the
  // chips give no way out of.
  const mixed = playlistFilter == null;
  const showOwn = mixed || playlistFilter === "you";
  const showFriends = mixed || playlistFilter === "friends";

  return (
    <Screen scrollKey="library">
      <ChipRow>
        <Chip
          ref={crateChipRef}
          label="The Crate"
          icon={CrateIcon}
          active={tab === "crate"}
          onClick={() => setTab("crate")}
        />
        <Chip
          label="Playlists"
          active={tab === "playlists"}
          onClick={() => {
            setTab("playlists");
            // Reopening Playlists always shows the mixed you+friends view,
            // even if a subbar chip was left selected from before — a filter
            // this chip itself resets is easier to reason about than one that
            // silently remembers whatever it was last left at.
            setPlaylistFilter(null);
          }}
        />
        <Chip
          label="Albums"
          active={tab === "albums"}
          onClick={() => setTab("albums")}
        />
        <Chip
          label="Artists"
          active={tab === "artists"}
          onClick={() => setTab("artists")}
        />
      </ChipRow>

      {tab === "playlists" ? (
        <>
          <div style={{ marginTop: 14 }}>
            <SubBar
              items={[
                { key: "you", label: "By you" },
                { key: "friends", label: "By friends" },
              ]}
              active={playlistFilter ?? ""}
              onSelect={(key) =>
                setPlaylistFilter((f) => (f === key ? null : (key as PlaylistFilter)))
              }
              inset={playlistsInset}
            />
          </div>

          <SectionHeader
            title="Playlists"
            action="+ New"
            onAction={() => setNaming(true)}
            spaceAbove={14}
          />
          <Grid
            items={[
              // Favourites is a cut of your own library, never a friend's, so
              // it belongs only alongside your own playlists — pinned first
              // among them rather than fixed regardless of the chips.
              ...(showOwn
                ? [
                    {
                      key: "favorites",
                      name: "Favourites",
                      art: favoritesArt,
                      caption: <Counted count={favorites} one="track" />,
                      to: { type: "favorites" } as View,
                    },
                    ...playlists.map((p) => ({
                      key: p.id,
                      name: p.name,
                      cover: p.cover_track_id,
                      art: api.playlistArtworkUrl(p),
                      caption: <Counted count={p.track_count ?? 0} one="track" />,
                      to: { type: "playlist", id: p.id, name: p.name } as View,
                    })),
                  ]
                : []),
              // Yours says how much is in it, theirs says whose it is — same
              // rule HomeView's shelf cards already follow.
              ...(showFriends
                ? followedPlaylists.map((p) => ({
                    key: p.id,
                    name: p.name,
                    cover: p.cover_track_id,
                    art: api.playlistArtworkUrl(p),
                    caption: personName(p.person),
                    to: { type: "playlist", id: p.id, name: p.name } as View,
                  }))
                : []),
            ]}
            nav={nav}
          />
        </>
      ) : tab === "albums" ? (
        albums.length === 0 ? (
          <Empty
            title="No albums yet"
            body="Albums appear once your tracks carry an album tag. Edit any track to add one."
          />
        ) : (
          <div style={{ marginTop: 16 }}>
            <Grid
              items={albums.map((a) => ({
                key: a.name,
                name: a.name,
                cover: a.cover_track_id,
                caption: <Counted count={a.track_count} one="track" />,
                to: { type: "album", name: a.name } as View,
              }))}
              nav={nav}
            />
          </div>
        )
      ) : tab === "artists" ? (
        artists.length === 0 ? (
          <Empty
            title="No artists yet"
            body="Artists appear once your tracks carry an artist tag."
          />
        ) : (
          <div style={{ marginTop: 16 }}>
            <Circles artists={artists} nav={nav} wrap />
          </div>
        )
      ) : (
        <div style={{ marginTop: 14 }}>
          <CrateSection nav={nav} filter={crateSub} onFilterChange={setCrateSub} />
        </div>
      )}

      <NameSheet
        open={naming}
        title="New playlist"
        confirmLabel="Create"
        onSubmit={(name) => void newPlaylist(name)}
        onClose={() => setNaming(false)}
      />
    </Screen>
  );
}

/**
 * The square tiles: playlists and albums are the same shape and the same tap.
 *
 * Three to a row, not four. A playlist is something you aim at and its cover
 * is the only way to tell it apart at a glance, so the tile is sized to be
 * recognisable rather than to fit as many as possible above the fold.
 *
 * There is deliberately no "new playlist" tile here. Making one is not a
 * playlist, and a dashed square the size of a real cover claimed the same
 * weight as your actual music — the compact `+ New` in the section header
 * says the same thing without pretending to be an item in the list.
 */
function Grid({
  items,
  nav,
}: {
  items: {
    key: string;
    name: string;
    /** A track id whose artwork stands in for the tile. */
    cover?: string | null;
    /** A picture the item owns outright — a playlist cover. Wins over `cover`. */
    art?: string | null;
    caption: React.ReactNode;
    to: View;
  }[];
  nav: Navigation;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 12,
      }}
    >
      {items.map((item, i) => (
        <button
          key={item.key}
          className="nav-press nav-row-in"
          onClick={() => {
            haptic.tap();
            nav.push(item.to);
          }}
          style={
            {
              "--i": i,
              display: "flex",
              flexDirection: "column",
              alignItems: "stretch",
              textAlign: "left",
              minWidth: 0,
            } as React.CSSProperties
          }
        >
          <CollectionArt
            name={item.name}
            coverTrackId={item.cover}
            src={item.art}
            size={112}
            radius={13}
            fill
          />
          <span
            className="nav-clamp-2"
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              lineHeight: 1.25,
              marginTop: 8,
            }}
          >
            {item.name}
          </span>
          <span
            style={{ fontSize: 11, color: "var(--color-nav-muted)", marginTop: 1 }}
          >
            {item.caption}
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * Artists, as circles.
 *
 * The tile is 78px wide for a 64px circle, and the name below it is allowed two
 * lines. At 60px with a single ellipsised line almost every real artist name
 * was cut to three or four characters, which is not a label — it is a shape
 * that happens to contain letters. Two lines of 10.5px holds around twenty
 * characters, and the clamp only bites on the genuinely long ones.
 */
function Circles({
  artists,
  nav,
  wrap = false,
}: {
  artists: Grouped[];
  nav: Navigation;
  wrap?: boolean;
}) {
  const tile = (artist: Grouped, i: number) => (
    <button
      key={artist.name}
      className="nav-press nav-row-in"
      onClick={() => {
        haptic.tap();
        nav.push({ type: "artist", name: artist.name });
      }}
      style={
        {
          "--i": i,
          width: 78,
          flex: "none",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 7,
        } as React.CSSProperties
      }
    >
      <CollectionArt
        name={artist.name}
        coverTrackId={artist.cover_track_id}
        size={64}
        radius={32}
        round
      />
      <span
        className="nav-clamp-2"
        style={{
          fontSize: 11,
          lineHeight: 1.25,
          width: "100%",
          textAlign: "center",
          color: "rgba(255,255,255,.82)",
        }}
      >
        {artist.name}
      </span>
    </button>
  );

  if (wrap) {
    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(78px, 1fr))",
          justifyItems: "center",
          rowGap: 12,
          columnGap: 6,
        }}
      >
        {artists.map(tile)}
      </div>
    );
  }
  return (
    <div className="nav-shelf nav-shelf-bleed" style={{ gap: 6 }}>
      {artists.map(tile)}
    </div>
  );
}
