import { useState } from "react";
import * as api from "../api";
import type { Playlist, Track } from "../types";
import { useLibrary } from "../context/LibraryContext";
import { usePlayer } from "../context/PlayerContext";
import { useToast } from "../context/ToastContext";
import { ActionButton, GhostButton, Sheet, SheetDivider, SheetItem } from "./ui";
import { CollectionArt } from "./PixelArt";
import {
  AlbumIcon,
  EditIcon,
  ListMinusIcon,
  PlayNextIcon,
  PlaylistIcon,
  QueueAddIcon,
  TrashIcon,
  UserIcon,
} from "../icons";
import { trackArtist, trackTitle } from "../lib/format";
import { haptic } from "../telegram";

/**
 * The `⋯` behind every track row.
 *
 * The order is fixed everywhere the menu appears — queue actions, then where
 * this track lives, then editing, then deletion last and alone. A menu whose
 * items move between screens has to be read every time instead of aimed at.
 *
 * The two ways a track can leave are the one place this menu works hard.
 * Taking it out of a playlist and deleting it from the library are not two
 * strengths of the same action, so they no longer look like it: they use
 * different verbs, they carry different glyphs, they sit in different groups
 * with a rule between them, and only the one that is actually destructive is
 * red. The first also names the playlist, so there is no reading required to
 * know which list is about to lose a track.
 *
 * What is missing is as deliberate: a track you do not own offers the queue
 * actions and the collections it belongs to, and nothing else. There is no
 * greyed-out `Edit` teaching you about a permission you cannot have.
 */

export interface TrackMenuTarget {
  track: Track;
  /** Present in a playlist, so the menu can offer to take it back out. */
  playlistId?: string;
  /** That playlist's name, so the menu can say which one it means. */
  playlistName?: string;
}

export function TrackMenu({
  target,
  onClose,
  onGoTo,
}: {
  target: TrackMenuTarget | null;
  onClose: () => void;
  onGoTo: (to: { type: "album" | "artist"; name: string }) => void;
}) {
  const { owns, putTrack, dropTracks, playlists } = useLibrary();
  const { queueNext, queueLast } = usePlayer();
  const { toast, undoToast } = useToast();

  const [adding, setAdding] = useState<Track | null>(null);
  const [editing, setEditing] = useState<Track | null>(null);

  const track = target?.track ?? null;
  const owned = track ? owns(track) : false;

  const removeFromLibrary = async (t: Track) => {
    // The row leaves now and the server is told now; undo restores it. A
    // confirmation dialog would ask everyone to answer for the mistake a few
    // people make, and the answer is already reversible.
    dropTracks([t.id]);
    onClose();
    try {
      await api.deleteTrack(t.id);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not remove that");
      return;
    }
    undoToast(`Removed ${trackTitle(t)}`, () => {
      void api
        .restoreTrack(t.id)
        .then(putTrack)
        .catch(() => toast("Could not put that back"));
    });
  };

  const removeFromPlaylist = async (t: Track, playlistId: string) => {
    onClose();
    try {
      await api.removeTracksFromPlaylist(playlistId, [t.id]);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not remove that");
      return;
    }
    undoToast("Removed from playlist", () => {
      void api.addTracksToPlaylist(playlistId, [t.id]);
    });
  };

  return (
    <>
      <Sheet
        open={target != null && !adding && !editing}
        onClose={onClose}
        title={track ? `${trackTitle(track)} · ${trackArtist(track)}` : undefined}
      >
        {track ? (
          <>
            <SheetItem
              icon={PlayNextIcon}
              label="Play next"
              onClick={() => {
                queueNext(track);
                toast("Playing next");
                onClose();
              }}
            />
            <SheetItem
              icon={QueueAddIcon}
              label="Add to queue"
              onClick={() => {
                queueLast(track);
                toast("Added to queue");
                onClose();
              }}
            />
            <SheetDivider />

            {owned ? (
              <SheetItem
                icon={PlaylistIcon}
                label="Add to playlist"
                onClick={() => setAdding(track)}
              />
            ) : null}
            {track.album ? (
              <SheetItem
                icon={AlbumIcon}
                label={`Go to ${track.album}`}
                onClick={() => {
                  onGoTo({ type: "album", name: track.album! });
                  onClose();
                }}
              />
            ) : null}
            {track.artist ? (
              <SheetItem
                icon={UserIcon}
                label={`Go to ${track.artist}`}
                onClick={() => {
                  onGoTo({ type: "artist", name: track.artist! });
                  onClose();
                }}
              />
            ) : null}
            {owned ? (
              <SheetItem
                icon={EditIcon}
                label="Edit details"
                onClick={() => setEditing(track)}
              />
            ) : null}
            {owned && target?.playlistId ? (
              <SheetItem
                icon={ListMinusIcon}
                label={
                  target.playlistName
                    ? `Remove from ${target.playlistName}`
                    : "Remove from this playlist"
                }
                onClick={() => void removeFromPlaylist(track, target.playlistId!)}
              />
            ) : null}

            {owned ? (
              <>
                <SheetDivider />
                <SheetItem
                  icon={TrashIcon}
                  label="Delete from library"
                  destructive
                  onClick={() => void removeFromLibrary(track)}
                />
              </>
            ) : null}
          </>
        ) : null}
      </Sheet>

      <AddToPlaylistSheet
        tracks={adding ? [adding] : []}
        playlists={playlists}
        onClose={() => {
          setAdding(null);
          onClose();
        }}
      />

      <EditTrackSheet
        track={editing}
        onClose={() => {
          setEditing(null);
          onClose();
        }}
      />
    </>
  );
}

/**
 * Picking a home for one track or for a whole selection. The same sheet serves
 * both, because "add these forty" and "add this one" are the same decision.
 */
export function AddToPlaylistSheet({
  tracks,
  playlists,
  onClose,
}: {
  tracks: Track[];
  playlists: Playlist[];
  onClose: () => void;
}) {
  const { putPlaylist } = useLibrary();
  const { toast } = useToast();
  const [creating, setCreating] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async (playlist: Playlist) => {
    setBusy(true);
    try {
      const { added } = await api.addTracksToPlaylist(
        playlist.id,
        tracks.map((t) => t.id)
      );
      putPlaylist({
        ...playlist,
        track_count: (playlist.track_count ?? 0) + added,
      });
      haptic.success();
      toast(
        added === tracks.length
          ? `Added to ${playlist.name}`
          : `${added} added to ${playlist.name}`
      );
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not add those");
    } finally {
      setBusy(false);
    }
  };

  const createAndAdd = async () => {
    const name = creating.trim();
    if (!name) return;
    setBusy(true);
    try {
      const playlist = await api.createPlaylist(name);
      putPlaylist(playlist);
      setCreating("");
      await add(playlist);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not make that playlist");
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={tracks.length > 0}
      onClose={onClose}
      title={tracks.length === 1 ? trackTitle(tracks[0]) : `${tracks.length} tracks`}
    >
      <div style={{ display: "flex", gap: 8, padding: "0 8px 10px" }}>
        <input
          value={creating}
          onChange={(e) => setCreating(e.target.value)}
          placeholder="New playlist"
          className="nav-glass"
          style={{
            flex: 1,
            height: 38,
            borderRadius: 19,
            padding: "0 14px",
            fontSize: 13,
            color: "#fff",
            outline: "none",
            border: 0,
          }}
        />
        <ActionButton
          grow={false}
          disabled={busy || creating.trim().length === 0}
          onClick={() => void createAndAdd()}
        >
          Create
        </ActionButton>
      </div>

      <div style={{ maxHeight: "44vh", overflowY: "auto" }}>
        {playlists.map((playlist) => (
          <button
            key={playlist.id}
            className="nav-press"
            disabled={busy}
            onClick={() => void add(playlist)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              width: "100%",
              minHeight: 52,
              padding: "0 14px",
              borderRadius: 12,
              textAlign: "left",
            }}
          >
            <CollectionArt
              name={playlist.name}
              coverTrackId={playlist.cover_track_id}
              size={36}
              radius={8}
            />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="nav-clip" style={{ display: "block", fontSize: 13 }}>
                {playlist.name}
              </span>
              <span
                style={{ fontSize: 10.5, color: "rgba(255,255,255,.5)" }}
              >
                {playlist.track_count ?? 0} tracks
              </span>
            </span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/** Title, artist, album. Everything else about a track is Telegram's. */
export function EditTrackSheet({
  track,
  onClose,
}: {
  track: Track | null;
  onClose: () => void;
}) {
  const { putTrack } = useLibrary();
  const { toast } = useToast();
  const [draft, setDraft] = useState<api.TrackEdit>({});
  const [busy, setBusy] = useState(false);

  const value = (field: "title" | "artist" | "album") =>
    (draft[field] as string | null | undefined) ?? track?.[field] ?? "";

  // Nothing typed, nothing to save. The button being dead until there is a
  // change is what tells you the sheet has registered what you typed, and it
  // is also the only honest state for a Save that would otherwise PATCH three
  // fields with the values they already have.
  const dirty = Object.keys(draft).length > 0;

  const close = () => {
    setDraft({});
    onClose();
  };

  const save = async () => {
    if (!track) return;
    setBusy(true);
    try {
      putTrack(await api.updateTrack(track.id, draft));
      haptic.success();
      setDraft({});
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not save that");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={track != null} onClose={close} title="Edit details">
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 9,
          padding: "0 8px 12px",
        }}
      >
        {(["title", "artist", "album"] as const).map((field) => (
          <label key={field} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 10.5, color: "rgba(255,255,255,.52)" }}>
              {field[0].toUpperCase() + field.slice(1)}
            </span>
            <input
              value={value(field)}
              onChange={(e) =>
                setDraft((d) => ({ ...d, [field]: e.target.value || null }))
              }
              className="nav-glass"
              style={{
                height: 40,
                borderRadius: 12,
                padding: "0 13px",
                fontSize: 13.5,
                color: "#fff",
                outline: "none",
                border: 0,
              }}
            />
          </label>
        ))}
        {/* Cancel is the same size as Save and sits beside it rather than
            under it: on a sheet the only other way out is the scrim, and a
            scrim is not a control anybody is sure about. Save keeps the whole
            remaining width because it is what the sheet is for. */}
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <GhostButton width={96} height={44} onClick={close}>
            Cancel
          </GhostButton>
          <ActionButton
            height={44}
            disabled={busy || !dirty}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : "Save"}
          </ActionButton>
        </div>
      </div>
    </Sheet>
  );
}
