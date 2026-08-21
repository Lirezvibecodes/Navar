import { useState } from "react";
import { trackCoverUrl, updateTrack, uploadCover } from "../api";
import type { Track } from "../types";

interface TrackEditModalProps {
  track: Track;
  onClose: () => void;
  onSaved: (track: Track) => void;
}

export function TrackEditModal({ track, onClose, onSaved }: TrackEditModalProps) {
  const [title, setTitle] = useState(track.title ?? "");
  const [artist, setArtist] = useState(track.artist ?? "");
  const [album, setAlbum] = useState(track.album ?? "");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const coverPreview = coverFile
    ? URL.createObjectURL(coverFile)
    : track.has_cover
      ? trackCoverUrl(track.id)
      : null;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      let updated = await updateTrack(track.id, { title, artist, album });
      if (coverFile) {
        updated = await uploadCover(track.id, coverFile);
      }
      onSaved(updated);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-lg bg-app-surface p-5">
        <h2 className="mb-4 text-lg font-semibold">Edit track</h2>

        <div className="mb-4 flex items-center gap-3">
          <div className="h-16 w-16 shrink-0 overflow-hidden rounded bg-app-surface-hover">
            {coverPreview ? (
              <img src={coverPreview} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-app-text-muted">
                ♪
              </div>
            )}
          </div>
          <label className="cursor-pointer rounded bg-app-surface-hover px-3 py-1.5 text-sm hover:bg-app-surface-hover/70">
            Change cover
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs text-app-text-muted">
            Title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="rounded bg-app-bg px-3 py-2 text-sm text-app-text outline-none ring-1 ring-app-surface-hover focus:ring-app-accent"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-app-text-muted">
            Artist
            <input
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              className="rounded bg-app-bg px-3 py-2 text-sm text-app-text outline-none ring-1 ring-app-surface-hover focus:ring-app-accent"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-app-text-muted">
            Album
            <input
              value={album}
              onChange={(e) => setAlbum(e.target.value)}
              className="rounded bg-app-bg px-3 py-2 text-sm text-app-text outline-none ring-1 ring-app-surface-hover focus:ring-app-accent"
            />
          </label>
        </div>

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded px-3 py-1.5 text-sm text-app-text-muted hover:text-app-text"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded bg-app-accent px-4 py-1.5 text-sm font-medium text-black disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
