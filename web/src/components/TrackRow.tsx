import { useState } from "react";
import { trackCoverUrl } from "../api";
import type { Playlist, Track } from "../types";

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface TrackRowProps {
  track: Track;
  isActive: boolean;
  isPlaying: boolean;
  playlists: Playlist[];
  onPlay: () => void;
  onEdit: () => void;
  onAddToPlaylist: (playlistId: string) => void;
  onRemoveFromPlaylist?: () => void;
}

export function TrackRow({
  track,
  isActive,
  isPlaying,
  playlists,
  onPlay,
  onEdit,
  onAddToPlaylist,
  onRemoveFromPlaylist,
}: TrackRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [addSubmenuOpen, setAddSubmenuOpen] = useState(false);

  return (
    <div
      className={`group flex items-center gap-3 rounded-md px-3 py-2 hover:bg-app-surface-hover ${
        isActive ? "bg-app-surface-hover" : ""
      }`}
    >
      <button
        onClick={onPlay}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <div className="h-10 w-10 shrink-0 overflow-hidden rounded bg-app-surface">
          {track.has_cover ? (
            <img
              src={trackCoverUrl(track.id)}
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-app-text-muted">
              ♪
            </div>
          )}
        </div>
        <div className="min-w-0">
          <div
            className={`truncate text-sm font-medium ${
              isActive ? "text-app-accent" : "text-app-text"
            }`}
          >
            {track.title ?? "Untitled"}
            {isActive && isPlaying ? " ▸" : ""}
          </div>
          <div className="truncate text-xs text-app-text-muted">
            {track.artist ?? "Unknown artist"}
          </div>
        </div>
      </button>

      <span className="shrink-0 text-xs text-app-text-muted">
        {formatDuration(track.duration_seconds)}
      </span>

      <div className="relative shrink-0">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="rounded px-2 py-1 text-app-text-muted opacity-0 hover:bg-app-surface group-hover:opacity-100"
        >
          ⋯
        </button>
        {menuOpen && (
          <div
            className="absolute right-0 z-10 mt-1 w-44 rounded-md bg-app-surface-hover py-1 shadow-lg"
            onMouseLeave={() => {
              setMenuOpen(false);
              setAddSubmenuOpen(false);
            }}
          >
            <button
              onClick={() => {
                onEdit();
                setMenuOpen(false);
              }}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-app-surface"
            >
              Edit tags & cover
            </button>
            <div className="relative">
              <button
                onClick={() => setAddSubmenuOpen((v) => !v)}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-app-surface"
              >
                Add to playlist ▸
              </button>
              {addSubmenuOpen && (
                <div className="absolute left-full top-0 w-44 rounded-md bg-app-surface-hover py-1 shadow-lg">
                  {playlists.length === 0 && (
                    <div className="px-3 py-2 text-sm text-app-text-muted">
                      No playlists yet
                    </div>
                  )}
                  {playlists.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        onAddToPlaylist(p.id);
                        setMenuOpen(false);
                        setAddSubmenuOpen(false);
                      }}
                      className="block w-full truncate px-3 py-2 text-left text-sm hover:bg-app-surface"
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {onRemoveFromPlaylist && (
              <button
                onClick={() => {
                  onRemoveFromPlaylist();
                  setMenuOpen(false);
                }}
                className="block w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-app-surface"
              >
                Remove from playlist
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
