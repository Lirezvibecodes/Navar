import { useEffect, useRef, useState } from "react";
import * as api from "../api";
import type { Navigation } from "../App";
import { CollectionArt, Cover } from "../components/PixelArt";
import { NameSheet } from "../components/NameSheet";
import { ShareSheet } from "../components/ShareSheet";
import { TrackListScreen } from "../components/TrackListScreen";
import { Empty, GhostButton, Sheet, SheetDivider, SheetItem } from "../components/ui";
import {
  CheckIcon,
  DotsIcon,
  EditIcon,
  ImageIcon,
  NoteIcon,
  ShareIcon,
  TrashIcon,
} from "../icons";
import { useLibrary } from "../context/LibraryContext";
import { useToast } from "../context/ToastContext";
import { cacheKey, ttl, useCached } from "../lib/cache";
import { pluralise } from "../lib/format";
import { haptic } from "../telegram";
import type { PlaylistVisibility, Track } from "../types";

/**
 * One playlist.
 *
 * Its rows are fetched rather than filtered out of the library, because a
 * playlist has an order of its own and that order lives on the server. The
 * library's copy of the playlist supplies the name and the count so the header
 * is filled in before the tracks arrive.
 */
/**
 * What the options menu says about sharing, before you open the sheet.
 *
 * The line names the state rather than the action — "Share" would say nothing
 * about a playlist that is already out there, and this is the one setting on a
 * playlist with a consequence outside the app.
 */
const VISIBILITY_LABEL: Record<PlaylistVisibility, string> = {
  private: "Share this playlist",
  friends: "Shared with friends",
  public: "Anyone with the link",
};

export function PlaylistView({ nav, id }: { nav: Navigation; id: string }) {
  const { playlists, putPlaylist, dropPlaylist } = useLibrary();
  const { toast, undoToast } = useToast();

  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [picking, setPicking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [describing, setDescribing] = useState(false);
  const [sharing, setSharing] = useState(false);

  const playlist = playlists.find((p) => p.id === id);

  // The order lives on the server, so the rows are fetched rather than
  // filtered — but they are also the same rows every time this playlist is
  // opened, so the fetch is cached and the second visit paints immediately.
  const {
    data: rows,
    loading,
    error,
  } = useCached(
    cacheKey.playlistTracks(id),
    () => api.listPlaylistTracks(id),
    ttl.playlistTracks
  );
  const tracks = rows ?? [];

  useEffect(() => {
    if (error) toast(error.message);
  }, [error, toast]);

  const rename = async (name: string) => {
    if (!playlist) return;
    const before = playlist;
    putPlaylist({ ...playlist, name });
    try {
      putPlaylist(await api.updatePlaylist(id, { name }));
    } catch (err) {
      putPlaylist(before);
      toast(err instanceof Error ? err.message : "Could not rename that");
    }
  };

  // Empty means "no description", not an empty one: the server stores null
  // either way, so saving a cleared field is how you delete what you wrote.
  const describe = async (text: string) => {
    if (!playlist) return;
    const before = playlist;
    const description = text.length === 0 ? null : text;
    putPlaylist({ ...playlist, description });
    try {
      putPlaylist(await api.updatePlaylist(id, { description }));
    } catch (err) {
      putPlaylist(before);
      toast(err instanceof Error ? err.message : "Could not save that");
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

  /**
   * Give the playlist a picture of its own.
   *
   * Its own image outranks the pinned track below, which is the whole point:
   * until now the only way to put an arbitrary picture on a playlist was to
   * hide it on a track first. The image goes to the cover channel and the row
   * keeps a file_id, exactly as a track's artwork does.
   */
  const uploadArtwork = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      putPlaylist(await api.uploadPlaylistArtwork(id, file));
      haptic.success();
      setPicking(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not set that picture");
    } finally {
      setUploading(false);
      // Cleared so that picking the same file twice still fires a change.
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  /** Drop the picture; the pinned track — or the first with art — takes over again. */
  const clearArtwork = async () => {
    setUploading(true);
    try {
      putPlaylist(await api.clearPlaylistArtwork(id));
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not remove that picture");
    } finally {
      setUploading(false);
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
            src={playlist ? api.playlistArtworkUrl(playlist) : null}
            size={96}
            radius={16}
          />
        }
        name={playlist?.name ?? "Playlist"}
        subtitle={pluralise(playlist?.track_count ?? tracks.length, "track")}
        note={
          playlist?.description ? (
            <p
              className="nav-rise"
              style={{
                marginTop: 12,
                fontSize: 12.5,
                lineHeight: 1.5,
                color: "rgba(255,255,255,.62)",
                whiteSpace: "pre-wrap",
              }}
            >
              {playlist.description}
            </p>
          ) : null
        }
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
          icon={NoteIcon}
          label={playlist?.description ? "Edit description" : "Add a description"}
          onClick={() => {
            setMenuOpen(false);
            setDescribing(true);
          }}
        />
        <SheetItem
          icon={ImageIcon}
          label="Change cover"
          onClick={() => {
            setMenuOpen(false);
            setPicking(true);
          }}
        />
        <SheetItem
          icon={ShareIcon}
          label={VISIBILITY_LABEL[playlist?.visibility ?? "private"]}
          onClick={() => {
            setMenuOpen(false);
            setSharing(true);
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
        {/*
          Two ways to answer the same question, in precedence order: a picture
          the playlist owns, and below the rule, one of its tracks' covers to
          borrow. The upload sits first because it is the one that wins.
        */}
        <div style={{ display: "flex", gap: 8, padding: "2px 12px 10px" }}>
          <GhostButton
            icon={ImageIcon}
            height={34}
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading
              ? "Uploading…"
              : playlist?.has_cover
                ? "Replace image"
                : "Upload an image"}
          </GhostButton>
          {playlist?.has_cover ? (
            <GhostButton height={34} disabled={uploading} onClick={() => void clearArtwork()}>
              Remove
            </GhostButton>
          ) : null}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          onChange={(e) => void uploadArtwork(e.target.files?.[0])}
          style={{ display: "none" }}
        />
        <SheetDivider />
        <CoverPicker
          tracks={tracks}
          chosen={playlist?.cover_track_id ?? null}
          onPick={(trackId) => void chooseCover(trackId)}
        />
      </Sheet>

      <ShareSheet
        open={sharing}
        onClose={() => setSharing(false)}
        playlist={playlist}
        onChange={putPlaylist}
      />

      <NameSheet
        open={renaming}
        title="Rename playlist"
        initial={playlist?.name ?? ""}
        onSubmit={(name) => void rename(name)}
        onClose={() => setRenaming(false)}
      />

      <NameSheet
        open={describing}
        title="Playlist description"
        initial={playlist?.description ?? ""}
        placeholder="What is this playlist for?"
        multiline
        maxLength={500}
        allowEmpty
        onSubmit={(text) => void describe(text)}
        onClose={() => setDescribing(false)}
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
