import { useEffect, useMemo, useState } from "react";
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
} from "../components/ui";
import {
  albumsOf,
  artistsOf,
  useLibrary,
  type Grouped,
} from "../context/LibraryContext";
import { useToast } from "../context/ToastContext";
import { personName } from "../lib/format";
import { haptic } from "../telegram";
import { usePersistedState } from "../lib/persist";
import type { CrateFilter, View } from "../view";

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
 * `openCrate`/`openSearch` are launch intent carried on the push itself
 * (Home's "unsorted" nudge, the shared search icon) rather than live signals,
 * since by the time either would fire this screen may not be mounted yet. A
 * push that carries `openCrate` wins over whatever tab was showing last; a
 * plain tab reselect or a pop restores it instead — see the `restoring`
 * argument on each `usePersistedState` below.
 */
export function LibraryView({
  nav,
  openCrate,
  openSearch,
}: {
  nav: Navigation;
  openCrate?: CrateFilter;
  openSearch?: boolean;
}) {
  const { tracks, playlists, followedPlaylists, loading, putPlaylist } = useLibrary();
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
  // Spent on first render: switching to the Crate tab locally later, or
  // returning to this same mount another way, should not reopen search.
  const [autoSearch, setAutoSearch] = useState(openSearch ?? false);
  useEffect(() => {
    if (autoSearch) setAutoSearch(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [byYou, setByYou] = useState(false);
  const [byFriends, setByFriends] = useState(false);
  const [naming, setNaming] = useState(false);

  const albums = useMemo(() => albumsOf(tracks), [tracks]);
  const artists = useMemo(() => artistsOf(tracks), [tracks]);
  const favorites = useMemo(
    () => tracks.filter((t) => t.favorited_at != null).length,
    [tracks]
  );

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

  // Neither toggle chosen shows both — the mixed version — rather than
  // nothing, since a filter that can select itself into an empty screen is a
  // trap the chips give no way out of.
  const mixed = !byYou && !byFriends;
  const showOwn = mixed || byYou;
  const showFriends = mixed || byFriends;

  return (
    <Screen scrollKey="library">
      <ChipRow>
        <Chip
          label="Playlists"
          active={tab === "playlists"}
          onClick={() => setTab("playlists")}
        />
        <Chip
          label="Albums"
          count={albums.length}
          active={tab === "albums"}
          onClick={() => setTab("albums")}
        />
        <Chip
          label="Artists"
          count={artists.length}
          active={tab === "artists"}
          onClick={() => setTab("artists")}
        />
        <Chip
          label="The Crate"
          active={tab === "crate"}
          onClick={() => setTab("crate")}
        />
      </ChipRow>

      {tab === "playlists" ? (
        <>
          <ChipRow>
            <Chip label="By you" active={byYou} onClick={() => setByYou((v) => !v)} />
            <Chip
              label="By friends"
              active={byFriends}
              onClick={() => setByFriends((v) => !v)}
            />
          </ChipRow>

          <SectionHeader
            title="Playlists"
            action="+ New"
            onAction={() => setNaming(true)}
            spaceAbove={14}
          />
          <Grid
            items={[
              // Pinned regardless of the toggle above: it isn't anyone's
              // playlist, own or a friend's, so By you/By friends has nothing
              // to say about it.
              {
                key: "favorites",
                name: "Favourites",
                caption: <Counted count={favorites} one="track" />,
                onClick: () => {
                  setTab("crate");
                  setCrateSub("favorites");
                },
              },
              ...(showOwn
                ? playlists.map((p) => ({
                    key: p.id,
                    name: p.name,
                    cover: p.cover_track_id,
                    art: api.playlistArtworkUrl(p),
                    caption: <Counted count={p.track_count ?? 0} one="track" />,
                    to: { type: "playlist", id: p.id, name: p.name } as View,
                  }))
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
          <CrateSection
            nav={nav}
            filter={crateSub}
            onFilterChange={setCrateSub}
            autoSearch={autoSearch}
          />
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
 *
 * An item either goes somewhere (`to`, pushed onto the stack) or does
 * something in place (`onClick`) — the pinned Favourites tile is the one tile
 * of the second kind, since it opens the Crate tab rather than a screen.
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
    to?: View;
    onClick?: () => void;
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
            if (item.onClick) item.onClick();
            else if (item.to) nav.push(item.to);
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
