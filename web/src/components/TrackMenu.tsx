import { useRef, useState } from "react";
import * as api from "../api";
import type { Playlist, Track } from "../types";
import { cacheKey, dropCache } from "../lib/cache";
import { useLibrary } from "../context/LibraryContext";
import { usePlayer } from "../context/PlayerContext";
import { useToast } from "../context/ToastContext";
import {
  ActionButton,
  GhostButton,
  Sheet,
  SheetDivider,
  SheetItem,
  TextField,
} from "./ui";
import { CollectionArt, Cover } from "./PixelArt";
import {
  AlbumIcon,
  EditIcon,
  ImageIcon,
  LibraryIcon,
  ListMinusIcon,
  PlayNextIcon,
  PlaylistIcon,
  QueueAddIcon,
  ShareIcon,
  SparklesIcon,
  TrashIcon,
  UserIcon,
} from "../icons";
import { pluralise, trackArtist, trackTitle } from "../lib/format";
import { haptic, shareLink } from "../telegram";
import { LyricsPickerSheet } from "./LyricsPickerSheet";
import { StoryOutputSheet, type StoryPick } from "./StoryOutputSheet";

/**
 * The `⋯` behind every track row.
 *
 * The order is fixed everywhere the menu appears — queue actions, then where
 * this track lives, then editing, then deletion last and alone. A menu whose
 * items move between screens has to be read every time instead of aimed at.
 *
 * The two ways a track can leave are the one place this menu works hard.
 * Taking it out of a playlist and deleting it from the Crate are not two
 * strengths of the same action, so they no longer look like it: they use
 * different verbs, they carry different glyphs, they sit in different groups
 * with a rule between them, and only the one that is actually destructive is
 * red. The first also names the playlist, so there is no reading required to
 * know which list is about to lose a track.
 *
 * What is missing is as deliberate: a track you do not own offers the queue
 * actions, keeping it, and the collections it belongs to, and nothing else.
 * There is no greyed-out `Edit` teaching you about a permission you cannot
 * have. Keeping it comes first in that group because it is the only item there
 * that changes anything, and it is the whole reason for listening to somebody
 * else's playlist in the first place.
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
  const { owns, tracks, putTrack, dropTracks, playlists, markInPlaylist } =
    useLibrary();
  const { queueNext, queueLast } = usePlayer();
  const { toast, errorToast, undoToast } = useToast();

  const [adding, setAdding] = useState<Track | null>(null);
  const [editing, setEditing] = useState<Track | null>(null);
  const [pickingLyric, setPickingLyric] = useState<Track | null>(null);
  const [storyPick, setStoryPick] = useState<StoryPick | null>(null);

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
      errorToast(err, "Could not remove that");
      return;
    }
    undoToast(`Removed ${trackTitle(t)}`, () => {
      void api
        .restoreTrack(t.id)
        .then(putTrack)
        .catch(() => toast("Could not put that back"));
    });
  };

  /**
   * Keeping somebody else's track. No file moves — the server copies the row —
   * so this is as quick as it looks, and what lands in your Crate is a copy of
   * your own that survives the other person deleting theirs.
   */
  const saveToLibrary = async (t: Track) => {
    onClose();
    try {
      const copy = await api.saveTrack(t.id);
      // Saving something twice is answered with the copy made the first time,
      // so the toast says which of the two happened rather than claiming a
      // second copy that does not exist.
      const had = tracks.some((row) => row.id === copy.id);
      putTrack(copy);
      haptic.success();
      toast(had ? "Already in your Crate" : `Saved ${trackTitle(t)}`);
    } catch (err) {
      errorToast(err, "Could not save that");
    }
  };

  /**
   * A link for handing this track to somebody outside Navaar entirely.
   * Minting it requires a session, which is why this is owned-only even
   * though the page it opens needs no account at all.
   */
  const share = async (t: Track) => {
    try {
      const { url } = await api.shareTrack(t.id);
      if (!shareLink(url, `Listen to ${trackTitle(t)} on Navaar`)) {
        toast("Not available outside Telegram");
      }
    } catch (err) {
      errorToast(err, "Could not create that link");
    } finally {
      onClose();
    }
  };

  // The one membership change with no crate row behind it: the track is
  // still yours and still in the Crate, so nothing in LibraryContext moves and
  // there is no invalidation to inherit. Undoing it goes back through
  // markInPlaylist, which drops the same key again.
  const removeFromPlaylist = async (t: Track, playlistId: string) => {
    onClose();
    try {
      await api.removeTracksFromPlaylist(playlistId, [t.id]);
      dropCache(cacheKey.playlistTracks(playlistId), cacheKey.home);
    } catch (err) {
      errorToast(err, "Could not remove that");
      return;
    }
    undoToast("Removed from playlist", () => {
      void api.addTracksToPlaylist(playlistId, [t.id]).then(() =>
        markInPlaylist([t.id])
      );
    });
  };

  return (
    <>
      <Sheet
        open={target != null && !adding && !editing && !pickingLyric && !storyPick}
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

            {owned ? null : (
              <SheetItem
                icon={LibraryIcon}
                label="Save to my Crate"
                onClick={() => void saveToLibrary(track)}
              />
            )}
            {owned ? (
              <SheetItem
                icon={PlaylistIcon}
                label="Add to playlist"
                onClick={() => setAdding(track)}
              />
            ) : null}
            {owned ? (
              <SheetItem
                icon={ShareIcon}
                label="Share link"
                onClick={() => void share(track)}
              />
            ) : null}
            {owned ? (
              <SheetItem
                icon={SparklesIcon}
                label="Share to Story"
                onClick={() => setPickingLyric(track)}
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
                  label="Delete from my Crate"
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

      <LyricsPickerSheet
        track={pickingLyric}
        onPick={(lines) => {
          if (pickingLyric) setStoryPick({ track: pickingLyric, lines });
          setPickingLyric(null);
        }}
        onClose={() => {
          setPickingLyric(null);
          onClose();
        }}
      />

      <StoryOutputSheet
        pick={storyPick}
        onClose={() => {
          setStoryPick(null);
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
  const { putPlaylist, markInPlaylist } = useLibrary();
  const { toast, errorToast } = useToast();
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
      // The Crate splits All from Unsorted on `in_playlist`, which the server
      // computes at load. Without this the track a user has just filed stays
      // sitting in Unsorted until the next reload.
      markInPlaylist(tracks.map((t) => t.id));
      haptic.success();
      toast(
        added === tracks.length
          ? `Added to ${playlist.name}`
          : `${added} added to ${playlist.name}`
      );
      onClose();
    } catch (err) {
      errorToast(err, "Could not add those");
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
      errorToast(err, "Could not make that playlist");
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
        <TextField
          value={creating}
          onChange={setCreating}
          placeholder="New playlist"
          height={38}
        />
        <ActionButton
          grow={false}
          disabled={busy || creating.trim().length === 0}
          onClick={() => void createAndAdd()}
        >
          Create
        </ActionButton>
      </div>

      {playlists.length === 0 ? (
        <p
          style={{
            margin: 0,
            padding: "6px 14px 14px",
            fontSize: 12.5,
            lineHeight: 1.5,
            color: "var(--color-nav-muted)",
          }}
        >
          You have no playlists yet. Name one above and this track will be the
          first thing in it.
        </p>
      ) : null}

      {/* The list scrolls, and a scroller with a hard edge looks like a list
          that ends there. The mask fades the last row out instead, which is the
          only cue that there is more of it below the sheet. */}
      <div
        className="nav-scroll"
        style={{
          maxHeight: "44vh",
          overflowY: "auto",
          WebkitMaskImage:
            playlists.length > 5
              ? "linear-gradient(to bottom, #000 calc(100% - 28px), transparent)"
              : undefined,
          maskImage:
            playlists.length > 5
              ? "linear-gradient(to bottom, #000 calc(100% - 28px), transparent)"
              : undefined,
        }}
      >
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
              src={api.playlistArtworkUrl(playlist)}
              size={36}
              radius={8}
            />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="nav-clip" style={{ display: "block", fontSize: 13 }}>
                {playlist.name}
              </span>
              <span style={{ fontSize: 11, color: "var(--color-nav-muted)" }}>
                {pluralise(playlist.track_count ?? 0, "track")}
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
  const { errorToast } = useToast();
  const [draft, setDraft] = useState<api.TrackEdit>({});
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /*
   * Artwork saves on pick rather than on Save.
   *
   * It is a separate endpoint — the bytes go up as multipart while the three
   * text fields go up as JSON — so pretending the two share one button would
   * mean a Save that half-succeeds and a sheet that cannot say which half. The
   * picture changing under the picker the moment you choose is also the only
   * confirmation an image upload actually needs.
   */
  const pickArtwork = async (file: File | undefined) => {
    if (!file || !track) return;
    setUploading(true);
    try {
      putTrack(await api.uploadCover(track.id, file));
      haptic.success();
    } catch (err) {
      errorToast(err, "Could not set that artwork");
    } finally {
      setUploading(false);
      // Cleared so that picking the same file twice still fires a change.
      if (fileRef.current) fileRef.current.value = "";
    }
  };

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
      errorToast(err, "Could not save that");
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
        {track ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 3,
            }}
          >
            <Cover
              trackId={track.id}
              hasCover={track.has_cover}
              size={56}
              radius={12}
              style={{ opacity: uploading ? 0.5 : 1 }}
            />
            <div
              style={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
                gap: 6,
              }}
            >
              <div style={{ fontSize: 11, color: "var(--color-nav-muted)" }}>
                Artwork
              </div>
              <GhostButton
                icon={ImageIcon}
                height={34}
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                {uploading
                  ? "Uploading…"
                  : track.has_cover
                    ? "Replace"
                    : "Choose an image"}
              </GhostButton>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={(e) => void pickArtwork(e.target.files?.[0])}
              style={{ display: "none" }}
            />
          </div>
        ) : null}

        {(["title", "artist", "album"] as const).map((field) => (
          <label key={field} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 11, color: "var(--color-nav-muted)" }}>
              {field[0].toUpperCase() + field.slice(1)}
            </span>
            <TextField
              value={value(field)}
              onChange={(next) =>
                setDraft((d) => ({ ...d, [field]: next || null }))
              }
              fontSize={13.5}
              style={{ flex: "none", width: "100%" }}
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
