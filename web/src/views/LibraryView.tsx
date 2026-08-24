import { useMemo, useState } from "react";
import * as api from "../api";
import type { Navigation } from "../App";
import { CollectionArt } from "../components/PixelArt";
import { NameSheet } from "../components/NameSheet";
import {
  Chip,
  ChipRow,
  Empty,
  Screen,
  SectionHeader,
  Skeleton,
} from "../components/ui";
import { ChevronRightIcon, CrateIcon } from "../icons";
import {
  albumsOf,
  artistsOf,
  useLibrary,
  type Grouped,
} from "../context/LibraryContext";
import { useToast } from "../context/ToastContext";
import { pluralise } from "../lib/format";
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
  const { tracks, playlists, loading, putPlaylist } = useLibrary();
  const { toast } = useToast();
  const [tab, setTab] = useState<"all" | "albums" | "artists">("all");
  const [naming, setNaming] = useState(false);

  const albums = useMemo(() => albumsOf(tracks), [tracks]);
  const artists = useMemo(() => artistsOf(tracks), [tracks]);

  const newPlaylist = async (name: string) => {
    try {
      const playlist = await api.createPlaylist(name);
      putPlaylist(playlist);
      haptic.success();
      nav.push({ type: "playlist", id: playlist.id });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not make that playlist");
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
      <ChipRow>
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
          <button
            className="nav-press nav-card nav-rise"
            onClick={() => {
              haptic.tap();
              nav.push({ type: "crate", filter: "all" });
            }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              width: "100%",
              marginTop: 14,
              padding: 11,
              borderRadius: 16,
              textAlign: "left",
            }}
          >
            <span
              style={{
                width: 52,
                height: 52,
                borderRadius: 12,
                flex: "none",
                display: "grid",
                placeItems: "center",
                color: "#0A0A0A",
                background: "linear-gradient(150deg,#DFFC8E,#89AEFF)",
              }}
            >
              <CrateIcon size={24} />
            </span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="nav-clip" style={{ display: "block", fontSize: 14.5 }}>
                The Crate
              </span>
              <span
                style={{
                  display: "block",
                  fontSize: 11,
                  color: "rgba(255,255,255,.52)",
                  marginTop: 2,
                }}
              >
                Everything you own · {pluralise(tracks.length, "track")}
              </span>
            </span>
            <ChevronRightIcon size={16} style={{ color: "rgba(255,255,255,.35)" }} />
          </button>

          <SectionHeader title="Playlists" action="+ New" onAction={() => setNaming(true)} />
          <Grid
            items={playlists.map((p) => ({
              key: p.id,
              name: p.name,
              cover: p.cover_track_id,
              caption: pluralise(p.track_count ?? 0, "track"),
              to: { type: "playlist", id: p.id } as View,
            }))}
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
          <div style={{ marginTop: 14 }}>
            <Grid
              items={albums.map((a) => ({
                key: a.name,
                name: a.name,
                cover: a.cover_track_id,
                caption: pluralise(a.track_count, "track"),
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
        <div style={{ marginTop: 14 }}>
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
  items: { key: string; name: string; cover?: string | null; caption: string; to: View }[];
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
          style={{ "--i": i, textAlign: "left" } as React.CSSProperties}
        >
          <CollectionArt
            name={item.name}
            coverTrackId={item.cover}
            size={112}
            radius={13}
            fill
          />
          <span
            className="nav-clip"
            style={{ display: "block", fontSize: 12.5, fontWeight: 600, marginTop: 7 }}
          >
            {item.name}
          </span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,.5)" }}>
            {item.caption}
          </span>
        </button>
      ))}
    </div>
  );
}

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
          width: 60,
          flex: "none",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 5,
        } as React.CSSProperties
      }
    >
      <CollectionArt
        name={artist.name}
        coverTrackId={artist.cover_track_id}
        size={52}
        radius={26}
        round
      />
      <span
        className="nav-clip"
        style={{ fontSize: 10.5, maxWidth: "100%", textAlign: "center" }}
      >
        {artist.name}
      </span>
    </button>
  );

  if (wrap) {
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        {artists.map(tile)}
      </div>
    );
  }
  return (
    <div className="nav-shelf" style={{ gap: 12 }}>
      {artists.map(tile)}
    </div>
  );
}
