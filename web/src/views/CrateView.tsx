import { useEffect, useMemo, useRef, useState } from "react";
import * as api from "../api";
import type { Navigation } from "../App";
import { TrackRow } from "../components/TrackRow";
import { TrackMenu, AddToPlaylistSheet } from "../components/TrackMenu";
import type { TrackMenuTarget } from "../components/TrackMenu";
import {
  ActionButton,
  Chip,
  ChipRow,
  Empty,
  GhostButton,
  Portal,
  Screen,
  Skeleton,
} from "../components/ui";
import { CloseIcon, ListIcon, SearchIcon, ShuffleIcon, TrashIcon } from "../icons";
import { useLibrary } from "../context/LibraryContext";
import { usePlayer } from "../context/PlayerContext";
import { useToast } from "../context/ToastContext";
import { trackArtist, trackTitle } from "../lib/format";
import { haptic } from "../telegram";
import type { Track } from "../types";

/**
 * The Crate — everything you own, in one list.
 *
 * It is not a playlist and there is no row for it in the database. It is the
 * library itself, and the `All` / `Unsorted` split is a filter over the same
 * rows: Unsorted is the tracks that are in no playlist yet, which is the pile
 * the app is quietly asking you to deal with.
 *
 * Search is local. Every track you own is already in memory, so filtering as
 * you type costs nothing and works while the server is asleep; a search that
 * round-trips would be slower than reading the list.
 *
 * Selection mode lives only here. Selecting across a playlist or an album
 * raises questions about what "remove" means that this app does not need to
 * answer — in the Crate it means one thing.
 */

type Sort = "recent" | "title" | "artist";

const SORTS: { id: Sort; label: string }[] = [
  { id: "recent", label: "Recent" },
  { id: "title", label: "Title" },
  { id: "artist", label: "Artist" },
];

export function CrateView({
  nav,
  filter,
  autoSearch = false,
}: {
  nav: Navigation;
  filter: "all" | "unsorted";
  autoSearch?: boolean;
}) {
  const { tracks, loading, owns, setFavorite, dropTracks, putTrack, playlists } =
    useLibrary();
  const { current, isPlaying, playFrom, setShuffle } = usePlayer();
  const { toast, undoToast, setToastLift } = useToast();

  const [tab, setTab] = useState<"all" | "unsorted">(filter);
  const [sort, setSort] = useState<Sort>("recent");
  const [searching, setSearching] = useState(autoSearch);
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<TrackMenuTarget | null>(null);
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const [addingSelection, setAddingSelection] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searching) searchRef.current?.focus();
  }, [searching]);

  // The contextual action bar covers the Now Playing bar, so the snackbar has
  // to clear whichever of the two is actually on screen.
  useEffect(() => {
    setToastLift(selection ? 66 : 0);
    return () => setToastLift(0);
  }, [selection, setToastLift]);

  const unsortedCount = useMemo(
    () => tracks.filter((t) => !t.in_playlist).length,
    [tracks]
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = tab === "unsorted" ? tracks.filter((t) => !t.in_playlist) : tracks;
    if (q) {
      list = list.filter(
        (t) =>
          trackTitle(t).toLowerCase().includes(q) ||
          trackArtist(t).toLowerCase().includes(q) ||
          (t.album ?? "").toLowerCase().includes(q)
      );
    }
    const sorted = [...list];
    if (sort === "title") {
      sorted.sort((a, b) => trackTitle(a).localeCompare(trackTitle(b)));
    } else if (sort === "artist") {
      sorted.sort(
        (a, b) =>
          trackArtist(a).localeCompare(trackArtist(b)) ||
          trackTitle(a).localeCompare(trackTitle(b))
      );
    } else {
      sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
    }
    return sorted;
  }, [tracks, tab, query, sort]);

  const source = useMemo(
    () => ({
      label: tab === "unsorted" ? "Unsorted" : "The Crate",
      key: `crate:${tab}:${sort}:${query}`,
      tracks: rows,
    }),
    [tab, sort, query, rows]
  );

  const selected = selection ?? new Set<string>();
  const selectedTracks = rows.filter((t) => selected.has(t.id));

  const toggleSelect = (track: Track) => {
    setSelection((s) => {
      const next = new Set(s ?? []);
      if (next.has(track.id)) next.delete(track.id);
      else next.add(track.id);
      return next;
    });
  };

  const removeSelected = async () => {
    const going = selectedTracks;
    if (going.length === 0) return;
    const ids = going.map((t) => t.id);
    dropTracks(ids);
    setSelection(null);
    try {
      const { deleted } = await api.deleteTracks(ids);
      undoToast(`Removed ${deleted.length} tracks`, () => {
        void api.restoreTracks(deleted).then(() => {
          // Restored rows come back from the server rather than from the copy
          // held here, because the server owns their playlist membership.
          for (const track of going) putTrack(track);
        });
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not remove those");
    }
  };

  return (
    <>
      <Screen>
        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 2 }}>
          <ChipRow>
            <Chip
              label="All"
              count={tracks.length}
              active={tab === "all"}
              onClick={() => setTab("all")}
            />
            <Chip
              label="Unsorted"
              count={unsortedCount}
              active={tab === "unsorted"}
              onClick={() => setTab("unsorted")}
            />
          </ChipRow>
          <span style={{ flex: 1 }} />
          <SortControl sort={sort} onChange={setSort} />
        </div>

        {searching ? (
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your crate"
              className="nav-glass"
              style={{
                flex: 1,
                height: 38,
                borderRadius: 19,
                padding: "0 14px",
                fontSize: 13,
                color: "#fff",
                border: 0,
                outline: "none",
              }}
            />
            <GhostButton
              icon={CloseIcon}
              label="Close search"
              width={44}
              onClick={() => {
                setQuery("");
                setSearching(false);
              }}
            />
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <ActionButton
              onClick={() => rows.length > 0 && playFrom(source)}
              disabled={rows.length === 0}
            >
              Play all
            </ActionButton>
            <GhostButton
              icon={ShuffleIcon}
              label="Shuffle"
              width={44}
              onClick={() => {
                if (rows.length === 0) return;
                setShuffle(true);
                playFrom(source);
              }}
            />
            <GhostButton
              icon={SearchIcon}
              label="Search"
              width={44}
              onClick={() => setSearching(true)}
            />
            <GhostButton
              icon={ListIcon}
              label="Select tracks"
              width={44}
              onClick={() => setSelection(new Set())}
            />
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          {loading ? (
            <Skeleton />
          ) : rows.length === 0 ? (
            <Empty
              title={query ? "Nothing matched" : "Nothing here yet"}
              body={
                query
                  ? "Try part of a title, an artist or an album."
                  : tab === "unsorted"
                    ? "Every track you own is in a playlist. Nothing left to file."
                    : "Forward any audio file to the bot and it lands here, tagged and playable."
              }
            />
          ) : (
            rows.map((track, i) => (
              <TrackRow
                key={track.id}
                track={track}
                index={i}
                playing={current?.id === track.id && isPlaying}
                owned={owns(track)}
                favorited={track.favorited_at != null}
                query={query}
                selectable={selection != null}
                selected={selected.has(track.id)}
                onSelect={() => toggleSelect(track)}
                onEnterSelection={() => {
                  haptic.press();
                  setSelection(new Set([track.id]));
                }}
                onPlay={() => playFrom(source, track)}
                onMenu={() => setMenu({ track })}
                onToggleFavorite={() =>
                  void setFavorite(track, track.favorited_at == null)
                }
              />
            ))
          )}
        </div>
      </Screen>

      {selection ? (
        <SelectionBar
          count={selected.size}
          onCancel={() => setSelection(null)}
          onSelectAll={() => setSelection(new Set(rows.map((t) => t.id)))}
          onAdd={() => setAddingSelection(true)}
          onRemove={() => void removeSelected()}
        />
      ) : null}

      <AddToPlaylistSheet
        tracks={addingSelection ? selectedTracks : []}
        playlists={playlists}
        onClose={() => {
          setAddingSelection(false);
          setSelection(null);
        }}
      />

      <TrackMenu
        target={menu}
        onClose={() => setMenu(null)}
        onGoTo={(to) => nav.push(to)}
      />
    </>
  );
}

/** `Recent ⌄` — a text control rather than a chip, so it reads as a setting. */
function SortControl({
  sort,
  onChange,
}: {
  sort: Sort;
  onChange: (sort: Sort) => void;
}) {
  return (
    <button
      className="nav-press"
      onClick={() => {
        haptic.select();
        const at = SORTS.findIndex((s) => s.id === sort);
        onChange(SORTS[(at + 1) % SORTS.length].id);
      }}
      style={{
        flex: "none",
        height: 44,
        fontSize: 11,
        color: "rgba(255,255,255,.52)",
        paddingLeft: 8,
      }}
    >
      {SORTS.find((s) => s.id === sort)?.label} ⌄
    </button>
  );
}

/**
 * What the Now Playing bar becomes while a selection is open. It sits in the
 * same place and at the same size, so the bottom of the screen keeps its one
 * bar rather than growing a second one.
 */
function SelectionBar({
  count,
  onCancel,
  onSelectAll,
  onAdd,
  onRemove,
}: {
  count: number;
  onCancel: () => void;
  onSelectAll: () => void;
  onAdd: () => void;
  onRemove: () => void;
}) {
  // Portalled to the body. Every screen is rendered inside the view-transition
  // wrapper, whose animation makes it a stacking context for as long as the
  // fill-mode keeps the animation in effect — which is forever. Anything with a
  // z-index inside it is therefore trapped below the bottom furniture, and this
  // bar was being painted behind the nav bar rather than over it.
  return (
    <Portal>
      {/* Sized from the top down rather than pinned to `bottom`. A fixed box's
          bottom edge is the bottom of the layout viewport, and Android does not
          shrink that for its own keyboard — so this bar sat behind the keyboard
          the moment the search field took focus, which is exactly when it is
          most likely to be open. --tg-viewport-height follows the visual
          viewport instead. */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          height: "var(--tg-viewport-height, 100%)",
          zIndex: 40,
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          pointerEvents: "none",
        }}
      >
        <div
          className="nav-bar-in"
          style={{
            // --nav-bottomnav-h is published from the nav's own offsetHeight and
            // already carries the safe inset; adding it again lifts the bar by a
            // whole home indicator.
            marginBottom: "var(--nav-bottomnav-h)",
            padding: "8px 12px 0",
            pointerEvents: "auto",
          }}
        >
          <div
            className="nav-glass"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              height: 58,
              borderRadius: 29,
              padding: "0 8px 0 14px",
            }}
          >
            <button
              className="nav-press"
              onClick={onCancel}
              style={{ fontSize: 12.5, fontWeight: 600, minHeight: 44, flex: "none" }}
            >
              {count === 0 ? "Cancel" : `${count} selected`}
            </button>
            <span style={{ flex: 1 }} />
            <GhostButton onClick={onSelectAll} height={38} width={54}>
              All
            </GhostButton>
            <GhostButton
              icon={TrashIcon}
              label="Remove selected"
              width={44}
              onClick={onRemove}
              disabled={count === 0}
            />
            <ActionButton grow={false} onClick={onAdd} disabled={count === 0}>
              Add to…
            </ActionButton>
          </div>
        </div>
      </div>
    </Portal>
  );
}
