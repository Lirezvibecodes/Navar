import { useMemo, useState } from "react";
import * as api from "../api";
import type { Navigation } from "../App";
import { CollectionArt } from "../components/PixelArt";
import { NameSheet } from "../components/NameSheet";
import {
  Chip,
  ChipRow,
  Counted,
  Empty,
  Screen,
  SectionHeader,
  Skeleton,
} from "../components/ui";
import { ChevronRightIcon, CrateIcon, HeartIcon } from "../icons";
import {
  albumsOf,
  artistsOf,
  useLibrary,
  type Grouped,
} from "../context/LibraryContext";
import { useToast } from "../context/ToastContext";
import { personName } from "../lib/format";
import { haptic } from "../telegram";
import type { View } from "../view";

/**
 * Where your music is kept.
 *
 * The Crate comes first and does not look like a playlist, because it is not
 * one: it is the whole library, and putting it in the grid with the playlists
 * would make "everything you own" the same kind of thing as "gym".
 *
 * Albums and artists are grouped from rows already in memory rather than
 * fetched. The server has endpoints for both, and they are what the pages for
 * somebody else's library use.
 */
export function LibraryView({ nav }: { nav: Navigation }) {
  const { tracks, playlists, followedPlaylists, loading, putPlaylist } = useLibrary();
  const { errorToast } = useToast();
  const [tab, setTab] = useState<"all" | "albums" | "artists">("all");
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

  return (
    <Screen>
      <FavouritesTile count={favorites} onOpen={() => nav.push({ type: "crate", filter: "favorites" })} />

      <ChipRow>
        {/* The Crate is a destination rather than a filter, which is why it
            carries a glyph and the three filters do not. It used to be a card
            below this row; a card the width of the screen made "everything you
            own" look like a bigger thing than the library it is the whole of. */}
        <Chip
          label="The Crate"
          icon={CrateIcon}
          active={false}
          onClick={() => nav.push({ type: "crate", filter: "all" })}
        />
        <Chip label="All" active={tab === "all"} onClick={() => setTab("all")} />
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
      </ChipRow>

      {tab === "all" ? (
        <>
          <SectionHeader
            title="Playlists"
            action="+ New"
            onAction={() => setNaming(true)}
            spaceAbove={14}
          />
          <Grid
            items={[
              ...playlists.map((p) => ({
                key: p.id,
                name: p.name,
                cover: p.cover_track_id,
                art: api.playlistArtworkUrl(p),
                caption: <Counted count={p.track_count ?? 0} one="track" />,
                to: { type: "playlist", id: p.id, name: p.name } as View,
              })),
              // Yours says how much is in it, theirs says whose it is — same
              // rule HomeView's shelf cards already follow.
              ...followedPlaylists.map((p) => ({
                key: p.id,
                name: p.name,
                cover: p.cover_track_id,
                art: api.playlistArtworkUrl(p),
                caption: personName(p.person),
                to: { type: "playlist", id: p.id, name: p.name } as View,
              })),
            ]}
            nav={nav}
          />

          <SectionHeader title="Artists" />
          <Circles artists={artists.slice(0, 12)} nav={nav} />
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
      ) : artists.length === 0 ? (
        <Empty
          title="No artists yet"
          body="Artists appear once your tracks carry an artist tag."
        />
      ) : (
        <div style={{ marginTop: 16 }}>
          <Circles artists={artists} nav={nav} wrap />
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
 * Favourites, at the head of the library.
 *
 * The heart has been on every track row and in the player since the beginning,
 * and until this tile existed it wrote to a set no screen ever read. That is
 * the whole reason this is here: it is a door, not a decoration, and it is the
 * one bright thing on the screen because it is the only shortcut on it.
 *
 * Dark ink on the gradient. White on lime is unreadable, and the left half of
 * this tile is lime.
 */
function FavouritesTile({ count, onOpen }: { count: number; onOpen: () => void }) {
  return (
    <button
      className="nav-press nav-rise"
      onClick={() => {
        haptic.tap();
        onOpen();
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        width: "100%",
        height: 66,
        marginBottom: 12,
        padding: "0 14px",
        borderRadius: 16,
        textAlign: "left",
        color: "#0A0A0A",
        background: "linear-gradient(110deg, var(--color-nav-action), #89aeff)",
        boxShadow: "0 10px 26px rgba(0,0,0,.45)",
      }}
    >
      <span
        style={{
          display: "grid",
          placeItems: "center",
          flex: "none",
          width: 38,
          height: 38,
          borderRadius: 19,
          background: "rgba(10,10,10,.13)",
        }}
      >
        <HeartIcon size={18} />
      </span>

      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          className="nav-display"
          style={{ display: "block", fontSize: 16, lineHeight: 1.1 }}
        >
          Favourites
        </span>
        <span style={{ display: "block", marginTop: 3, fontSize: 11.5, opacity: 0.68 }}>
          <Counted count={count} one="track" />
        </span>
      </span>

      <ChevronRightIcon size={15} style={{ flex: "none", opacity: 0.55 }} />
    </button>
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
          rowGap: 18,
          columnGap: 8,
        }}
      >
        {artists.map(tile)}
      </div>
    );
  }
  return (
    <div className="nav-shelf nav-shelf-bleed" style={{ gap: 10 }}>
      {artists.map(tile)}
    </div>
  );
}
