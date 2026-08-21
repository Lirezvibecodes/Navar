import { useState } from "react";
import type { Playlist } from "../types";
import type { View } from "../view";

interface PlaylistsViewProps {
  playlists: Playlist[];
  onCreate: (name: string) => void;
  onOpen: (view: View) => void;
}

export function PlaylistsView({ playlists, onCreate, onOpen }: PlaylistsViewProps) {
  const [name, setName] = useState("");

  function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate(trimmed);
    setName("");
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Playlists</h1>

      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          placeholder="New playlist name"
          className="flex-1 rounded bg-app-surface px-3 py-2 text-sm outline-none ring-1 ring-app-surface-hover focus:ring-app-accent"
        />
        <button
          onClick={handleCreate}
          className="rounded bg-app-accent px-4 py-2 text-sm font-medium text-black"
        >
          Create
        </button>
      </div>

      {playlists.length === 0 ? (
        <p className="text-sm text-app-text-muted">No playlists yet — create one above.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {playlists.map((p) => (
            <button
              key={p.id}
              onClick={() => onOpen({ type: "playlist", id: p.id })}
              className="rounded-md px-3 py-2 text-left text-sm hover:bg-app-surface-hover"
            >
              📁 {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
