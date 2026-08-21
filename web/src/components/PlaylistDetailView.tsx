import { useState } from "react";
import type { Playlist, Track } from "../types";
import { TrackList } from "./TrackList";

interface PlaylistDetailViewProps {
  playlist: Playlist;
  tracks: Track[];
  playlists: Playlist[];
  onRename: (name: string) => void;
  onDelete: () => void;
  onEditTrack: (track: Track) => void;
  onAddToPlaylist: (track: Track, playlistId: string) => void;
  onRemoveFromPlaylist: (track: Track) => void;
}

export function PlaylistDetailView({
  playlist,
  tracks,
  playlists,
  onRename,
  onDelete,
  onEditTrack,
  onAddToPlaylist,
  onRemoveFromPlaylist,
}: PlaylistDetailViewProps) {
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(playlist.name);

  function handleRenameSave() {
    const trimmed = name.trim();
    if (trimmed && trimmed !== playlist.name) onRename(trimmed);
    setEditingName(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        {editingName ? (
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleRenameSave()}
            onBlur={handleRenameSave}
            className="rounded bg-app-surface px-3 py-1.5 text-2xl font-bold outline-none ring-1 ring-app-accent"
          />
        ) : (
          <h1
            className="cursor-pointer text-2xl font-bold"
            onClick={() => setEditingName(true)}
          >
            {playlist.name}
          </h1>
        )}
        <button
          onClick={onDelete}
          className="shrink-0 rounded px-3 py-1.5 text-sm text-red-400 hover:bg-app-surface-hover"
        >
          Delete playlist
        </button>
      </div>

      <TrackList
        tracks={tracks}
        playlists={playlists}
        emptyMessage="No tracks in this playlist yet."
        onEdit={onEditTrack}
        onAddToPlaylist={onAddToPlaylist}
        onRemoveFromPlaylist={onRemoveFromPlaylist}
      />
    </div>
  );
}
