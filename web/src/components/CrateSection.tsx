import { useEffect, useMemo, useState } from "react";
import * as api from "../api";
import type { Navigation } from "../App";
import { TrackRow } from "./TrackRow";
import { TrackMenu, AddToPlaylistSheet } from "./TrackMenu";
import type { TrackMenuTarget } from "./TrackMenu";
import { ActionButton, Empty, GhostButton, Num, Portal, SubBar } from "./ui";
import { ListIcon, ShuffleIcon, TrashIcon } from "../icons";
import { useLibrary } from "../context/LibraryContext";
import { usePlayer } from "../context/PlayerContext";
import { useToast } from "../context/ToastContext";
import { pluralise, trackArtist, trackTitle } from "../lib/format";
import { usePersistedState } from "../lib/persist";
import { haptic } from "../telegram";
import type { Track } from "../types";
import type { CrateFilter } from "../view";

/**
 * The Crate — everything you own, in one list.
 *
 * It is not a playlist and there is no row for it in the database. It is the
 * library itself, and the two subbar tabs are filters over the same rows. Unsorted
 * is the tracks that are in no playlist yet, which is the pile the app is
 * quietly asking you to deal with. Favourites left this screen for its own —
 * see FavoritesView — once it started looking enough like a playlist to want
 * a playlist's header instead of a filter chip.
 *
 * This renders as a tab of the Library screen rather than a screen of its
 * own, so which cut is showing is state LibraryView holds and hands down as
 * `filter`/`onFilterChange` — the same subbar and track list as before, just
 * without a page of its own to carry them.
 *
 * Searching the Crate happens on the shared Search screen now, reached from
 * the icon beside the profile picture — this section only shows the two
 * filters over what's already loaded.
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

export function CrateSection({
  nav,
  filter,
  onFilterChange,
}: {
  nav: Navigation;
  filter: CrateFilter;
  onFilterChange: (filter: CrateFilter) => void;
}) {
  const { tracks, owns, setFavorite, dropTracks, putTrack, playlists } =
    useLibrary();
  const { current, isPlaying, playFrom, queueNext, queueLast } = usePlayer();
  const { errorToast, undoToast, setToastLift } = useToast();

  const [sort, setSort] = usePersistedState<Sort>("crate:sort", "recent");
  const [menu, setMenu] = useState<TrackMenuTarget | null>(null);
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const [addingSelection, setAddingSelection] = useState(false);

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
    const list = filter === "unsorted" ? tracks.filter((t) => !t.in_playlist) : tracks;
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
  }, [tracks, filter, sort]);

  const source = useMemo(
    () => ({
      label: filter === "unsorted" ? "Unsorted" : "The Crate",
      key: `crate:${filter}:${sort}`,
      tracks: rows,
    }),
    [filter, sort, rows]
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
      undoToast(`Removed ${pluralise(deleted.length, "track")}`, () => {
        void api.restoreTracks(deleted).then(() => {
          // Restored rows come back from the server rather than from the copy
          // held here, because the server owns their playlist membership.
          for (const track of going) putTrack(track);
        });
      });
    } catch (err) {
      errorToast(err, "Could not remove those");
    }
  };

  return (
    <>
      <SubBar
        items={[
          { key: "all", label: "All", count: tracks.length },
          { key: "unsorted", label: "Unsorted", count: unsortedCount },
        ]}
        active={filter}
        onSelect={(key) => onFilterChange(key as CrateFilter)}
        trailing={<SortControl sort={sort} onChange={setSort} />}
      />

      <div className="nav-rise" style={{ display: "flex", gap: 8, marginTop: 14 }}>
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
            playFrom(source, undefined, true);
          }}
        />
        <GhostButton
          icon={ListIcon}
          label="Select tracks"
          width={44}
          onClick={() => setSelection(new Set())}
        />
      </div>

      <div style={{ marginTop: 14 }}>
        {rows.length === 0 ? (
          <Empty
            title="Nothing here yet"
            body={
              filter === "unsorted"
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
              onQueueNext={() => queueNext(track)}
              onQueueLast={() => queueLast(track)}
            />
          ))
        )}
      </div>

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
        color: "var(--color-nav-muted)",
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
          zIndex: "var(--z-action-bar)",
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
            // whole home indicator. The player bar is between the two when
            // something is playing, and is 0 when nothing is.
            marginBottom:
              "calc(var(--nav-bottomnav-h) + var(--nav-nowplaying-h))",
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
            {/* The way out of selection mode is always the same control in the
                same place. It used to become the count as soon as anything was
                ticked, which left the mode with no visible exit at exactly the
                moment somebody might want one. The count reads in the room
                that was empty anyway. */}
            <button
              className="nav-press"
              onClick={onCancel}
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                minHeight: 44,
                flex: "none",
              }}
            >
              Cancel
            </button>
            <span
              aria-live="polite"
              className="nav-clip"
              style={{
                flex: 1,
                minWidth: 0,
                paddingLeft: 10,
                fontSize: 12,
                color: "var(--color-nav-muted)",
              }}
            >
              {count === 0 ? "" : <><Num>{count}</Num> selected</>}
            </span>
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
