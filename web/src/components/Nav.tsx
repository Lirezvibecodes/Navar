import type { Playlist } from "../types";
import type { View } from "../view";

interface NavProps {
  view: View;
  playlists: Playlist[];
  onNavigate: (view: View) => void;
}

function isActive(view: View, target: View): boolean {
  if (target.type === "playlist") {
    return view.type === "playlist" && view.id === target.id;
  }
  return view.type === target.type;
}

export function Sidebar({ view, playlists, onNavigate }: NavProps) {
  return (
    <nav className="hidden w-56 shrink-0 flex-col gap-4 overflow-y-auto border-r border-app-surface-hover bg-app-bg p-4 md:flex">
      <div className="text-lg font-bold">Your Library</div>
      <button
        onClick={() => onNavigate({ type: "library" })}
        className={`rounded px-2 py-1.5 text-left text-sm ${
          isActive(view, { type: "library" })
            ? "bg-app-surface-hover text-app-text"
            : "text-app-text-muted hover:text-app-text"
        }`}
      >
        🎵 Library
      </button>
      <button
        onClick={() => onNavigate({ type: "playlists" })}
        className={`rounded px-2 py-1.5 text-left text-sm ${
          isActive(view, { type: "playlists" })
            ? "bg-app-surface-hover text-app-text"
            : "text-app-text-muted hover:text-app-text"
        }`}
      >
        📁 Playlists
      </button>
      <div className="mt-2 flex flex-col gap-1 border-t border-app-surface-hover pt-2">
        {playlists.map((p) => (
          <button
            key={p.id}
            onClick={() => onNavigate({ type: "playlist", id: p.id })}
            className={`truncate rounded px-2 py-1 text-left text-sm ${
              isActive(view, { type: "playlist", id: p.id })
                ? "bg-app-surface-hover text-app-text"
                : "text-app-text-muted hover:text-app-text"
            }`}
          >
            {p.name}
          </button>
        ))}
      </div>
    </nav>
  );
}

export function BottomNav({ view, onNavigate }: NavProps) {
  return (
    <nav className="flex shrink-0 border-t border-app-surface-hover bg-app-surface md:hidden">
      <button
        onClick={() => onNavigate({ type: "library" })}
        className={`flex-1 py-3 text-center text-sm ${
          isActive(view, { type: "library" }) ? "text-app-accent" : "text-app-text-muted"
        }`}
      >
        🎵 Library
      </button>
      <button
        onClick={() => onNavigate({ type: "playlists" })}
        className={`flex-1 py-3 text-center text-sm ${
          view.type === "playlists" || view.type === "playlist"
            ? "text-app-accent"
            : "text-app-text-muted"
        }`}
      >
        📁 Playlists
      </button>
    </nav>
  );
}
