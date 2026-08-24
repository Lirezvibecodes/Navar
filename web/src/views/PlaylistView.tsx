import { useEffect, useState } from "react";
import * as api from "../api";
import type { Navigation } from "../App";
import { CollectionArt, Cover } from "../components/PixelArt";
import { NameSheet } from "../components/NameSheet";
import { TrackListScreen } from "../components/TrackListScreen";
import { Empty, GhostButton, Sheet, SheetDivider, SheetItem } from "../components/ui";
import { CheckIcon, DotsIcon, EditIcon, ImageIcon, TrashIcon } from "../icons";
import { useLibrary } from "../context/LibraryContext";
import { useToast } from "../context/ToastContext";
import { pluralise } from "../lib/format";
import type { Track } from "../types";

/**
 * One playlist.
 *
 * Its rows are fetched rather than filtered out of the library, because a
 * playlist has an order of its own and that order lives on the server. The
 * library's copy of the playlist supplies the name and the count so the header
 * is filled in before the tracks arrive.
 */
export function PlaylistView({ nav, id }: { nav: Navigation; id: string }) {
  const { playlists, putPlaylist, dropPlaylist } = useLibrary();
  const { toast, undoToast } = useToast();

  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [picking, setPicking] = useState(false);

  const playlist = playlists.find((p) => p.id === id);

  useEffect(() => {
    let live = true;
    setLoading(true);
    api
      .listPlaylistTracks(id)
      .then((rows) => live && setTracks(rows))
      .catch((err: unknown) =>
        toast(err instanceof Error ? err.message : "Could not load that playlist")
      )
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [id, toast]);

  const rename = async (name: string) => {
    if (!playlist) return;
    const before = playlist;
    putPlaylist({ ...playlist, name });
    try {
      putPlaylist(await api.renamePlaylist(id, name));
    } catch (err) {
      putPlaylist(before);
      toast(err instanceof Error ? err.message : "Could not rename that");
    }
  };

  // The server keeps the chosen track id as an override, not as the value: a
  // playlist with no choice made still shows the art of its first track, and
  // clearing the choice goes back to that rather than to a blank square. So
  // this only ever sends an id or a null, and re-reads what the server decided.
  const chooseCover = async (trackId: string | null) => {
    if (!playlist) return;
    const before = playlist;
    setPicking(false);
    putPlaylist({ ...playlist, cover_track_id: trackId ?? before.cover_track_id });
    try {
      putPlaylist(await api.setPlaylistCover(id, trackId));
    } catch (err) {
      putPlaylist(before);
      toast(err instanceof Error ? err.message : "Could not change the cover");
    }
  };

  const remove = async () => {
    if (!playlist) return;
    const before = playlist;
    dropPlaylist(id);
    setMenuOpen(false);
    nav.pop();
    try {
      await api.deletePlaylist(id);
    } catch (err) {
      putPlaylist(before);
      toast(err instanceof Error ? err.message : "Could not delete that");
      return;
    }
    // Deleting a playlist never touches the tracks in it, which is what makes
    // this safe to undo by simply making it again.
    undoToast(`Deleted ${before.name}`, () => {
      void api
        .createPlaylist(before.name)
        .then(async (fresh) => {
          putPlaylist(fresh);
          if (tracks.length > 0) {
            await api.addTracksToPlaylist(
              fresh.id,
              tracks.map((t) => t.id)
            );
          }
        })
        .catch(() => toast("Could not put that back"));
    });
  };

  return (
    <>
      <TrackListScreen
        nav={nav}
        art={
          <CollectionArt
            name={playlist?.name ?? "Playlist"}
            coverTrackId={playlist?.cover_track_id ?? tracks[0]?.id}
            size={96}
            radius={16}
          />
        }
        name={playlist?.name ?? "Playlist"}
        subtitle={pluralise(playlist?.track_count ?? tracks.length, "track")}
        tracks={tracks}
        loading={loading}
        sourceKey={`playlist:${id}`}
        sourceLabel={playlist?.name ?? "Playlist"}
        playlistId={id}
        playlistName={playlist?.name}
        emptyTitle="Empty playlist"
        emptyBody="Open The Crate, select some tracks and add them here."
        actions={
          <GhostButton
            icon={DotsIcon}
            label="Playlist options"
            width={44}
            onClick={() => setMenuOpen(true)}
          />
        }
      />

      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title={playlist?.name}>
        <SheetItem
          icon={EditIcon}
          label="Rename"
          onClick={() => {
            setMenuOpen(false);
            setRenaming(true);
          }}
        />
        <SheetItem
          icon={ImageIcon}
          label="Change cover"
          disabled={tracks.length === 0}
          onClick={() => {
            setMenuOpen(false);
            setPicking(true);
          }}
        />
        <SheetDivider />
        <SheetItem
          icon={TrashIcon}
          label="Delete playlist"
          destructive
          onClick={() => void remove()}
        />
      </Sheet>

      <Sheet open={picking} onClose={() => setPicking(false)} title="Playlist cover">
        <CoverPicker
          tracks={tracks}
          chosen={playlist?.cover_track_id ?? null}
          onPick={(trackId) => void chooseCover(trackId)}
        />
      </Sheet>

      <NameSheet
        open={renaming}
        title="Rename playlist"
        initial={playlist?.name ?? ""}
        onSubmit={(name) => void rename(name)}
        onClose={() => setRenaming(false)}
      />
    </>
  );
}

/**
 * Pick which track's artwork stands for the playlist.
 *
 * Only tracks that actually carry an image are offered. A generated pixel
 * square is already what an artless playlist falls back to, so listing them
 * here would be offering you a choice between four versions of the same
 * nothing. If the playlist has no artwork at all the sheet says so instead of
 * showing an empty grid.
 *
 * The tick marks whichever track the playlist is currently wearing, including
 * the one it fell back to on its own, so the sheet opens already showing you
 * where you are rather than asking you to remember.
 */
function CoverPicker({
  tracks,
  chosen,
  onPick,
}: {
  tracks: Track[];
  chosen: string | null;
  onPick: (trackId: string | null) => void;
}) {
  const withArt = tracks.filter((t) => t.has_cover);

  if (withArt.length === 0) {
    return (
      <Empty
        title="No artwork to choose from"
        body="None of these tracks arrived with cover art. Forward one that has some, and it can stand for the playlist."
      />
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 8,
        maxHeight: "46vh",
        overflowY: "auto",
        padding: "2px 12px 4px",
      }}
    >
      {withArt.map((track) => (
        <button
          key={track.id}
          className="nav-press"
          aria-pressed={chosen === track.id}
          onClick={() => onPick(track.id)}
          style={{ position: "relative", display: "block" }}
        >
          <Cover
            trackId={track.id}
            hasCover
            size={68}
            radius={11}
            style={{
              width: "100%",
              height: "auto",
              aspectRatio: "1",
              outline:
                chosen === track.id
                  ? "2px solid var(--color-nav-action)"
                  : "1px solid rgba(255,255,255,.08)",
              outlineOffset: chosen === track.id ? 1 : 0,
            }}
          />
          {chosen === track.id ? (
            <span
              style={{
                position: "absolute",
                right: 4,
                bottom: 4,
                display: "grid",
                placeItems: "center",
                width: 20,
                height: 20,
                borderRadius: 10,
                background: "var(--color-nav-action)",
                color: "#0A0A0A",
              }}
            >
              <CheckIcon size={11} />
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
