import { useEffect, useState } from "react";
import * as api from "../api";
import type { Navigation } from "../App";
import { CollectionArt } from "../components/PixelArt";
import { NameSheet } from "../components/NameSheet";
import { TrackListScreen } from "../components/TrackListScreen";
import { GhostButton, Sheet, SheetItem } from "../components/ui";
import { DotsIcon, EditIcon, TrashIcon } from "../icons";
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
            size={72}
            radius={14}
          />
        }
        name={playlist?.name ?? "Playlist"}
        subtitle={pluralise(playlist?.track_count ?? tracks.length, "track")}
        tracks={tracks}
        loading={loading}
        sourceKey={`playlist:${id}`}
        sourceLabel={playlist?.name ?? "Playlist"}
        playlistId={id}
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
          icon={TrashIcon}
          label="Delete playlist"
          destructive
          onClick={() => void remove()}
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
