import { usePlayer } from "../context/PlayerContext";
import { trackCoverUrl } from "../api";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function NowPlayingBar() {
  const { currentTrack, isPlaying, progress, duration, togglePlay, next, prev, seek } =
    usePlayer();

  if (!currentTrack) return null;

  return (
    <div className="flex h-20 shrink-0 items-center gap-3 border-t border-app-surface-hover bg-app-surface px-4">
      <div className="h-12 w-12 shrink-0 overflow-hidden rounded bg-app-surface-hover">
        {currentTrack.has_cover ? (
          <img
            src={trackCoverUrl(currentTrack.id)}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-app-text-muted">
            ♪
          </div>
        )}
      </div>

      <div className="min-w-0 w-40 shrink-0">
        <div className="truncate text-sm font-medium">{currentTrack.title ?? "Untitled"}</div>
        <div className="truncate text-xs text-app-text-muted">
          {currentTrack.artist ?? "Unknown artist"}
        </div>
      </div>

      <div className="flex flex-1 flex-col items-center gap-1">
        <div className="flex items-center gap-4">
          <button onClick={prev} className="text-app-text-muted hover:text-app-text" aria-label="Previous">
            ⏮
          </button>
          <button
            onClick={togglePlay}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-app-text text-app-bg"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? "⏸" : "▶"}
          </button>
          <button onClick={next} className="text-app-text-muted hover:text-app-text" aria-label="Next">
            ⏭
          </button>
        </div>
        <div className="flex w-full max-w-md items-center gap-2 text-xs text-app-text-muted">
          <span className="w-9 text-right">{formatTime(progress)}</span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            value={progress}
            onChange={(e) => seek(Number(e.target.value))}
            className="h-1 flex-1 accent-app-accent"
          />
          <span className="w-9">{formatTime(duration)}</span>
        </div>
      </div>

      <div className="w-40 shrink-0" />
    </div>
  );
}
