import { useCallback, useEffect, useState } from "react";
import { BottomNav, Sidebar } from "./components/Nav";
import { NowPlayingBar } from "./components/NowPlayingBar";
import { TrackEditModal } from "./components/TrackEditModal";
import { TrackList } from "./components/TrackList";
import { PlaylistDetailView } from "./components/PlaylistDetailView";
import { PlaylistsView } from "./components/PlaylistsView";
import { PlayerProvider } from "./context/PlayerContext";
import {
  addTrackToPlaylist,
  authenticate,
  createPlaylist,
  deletePlaylist,
  listPlaylists,
  listPlaylistTracks,
  listTracks,
  removeTrackFromPlaylist,
  renamePlaylist,
} from "./api";
import { getTelegramWebApp } from "./telegram";
import type { Playlist, Track } from "./types";
import type { View } from "./view";

function AppContent() {
  const [ready, setReady] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [view, setView] = useState<View>({ type: "library" });
  const [tracks, setTracks] = useState<Track[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistTracks, setPlaylistTracks] = useState<Track[]>([]);
  const [editingTrack, setEditingTrack] = useState<Track | null>(null);

  useEffect(() => {
    const webApp = getTelegramWebApp();
    webApp?.ready();
    webApp?.expand();

    async function init() {
      try {
        if (webApp?.initData) {
          await authenticate(webApp.initData);
        }
        const [trackList, playlistList] = await Promise.all([listTracks(), listPlaylists()]);
        setTracks(trackList);
        setPlaylists(playlistList);
        setReady(true);
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : "Failed to authenticate");
      }
    }
    init();
  }, []);

  const refreshPlaylistTracks = useCallback(async (playlistId: string) => {
    const list = await listPlaylistTracks(playlistId);
    setPlaylistTracks(list);
  }, []);

  useEffect(() => {
    if (view.type === "playlist") {
      refreshPlaylistTracks(view.id);
    }
  }, [view, refreshPlaylistTracks]);

  async function handleCreatePlaylist(name: string) {
    const playlist = await createPlaylist(name);
    setPlaylists((prev) => [...prev, playlist]);
  }

  async function handleRenamePlaylist(playlist: Playlist, name: string) {
    const updated = await renamePlaylist(playlist.id, name);
    setPlaylists((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
  }

  async function handleDeletePlaylist(playlist: Playlist) {
    await deletePlaylist(playlist.id);
    setPlaylists((prev) => prev.filter((p) => p.id !== playlist.id));
    setView({ type: "playlists" });
  }

  async function handleAddToPlaylist(track: Track, playlistId: string) {
    await addTrackToPlaylist(playlistId, track.id);
    if (view.type === "playlist" && view.id === playlistId) {
      await refreshPlaylistTracks(playlistId);
    }
  }

  async function handleRemoveFromPlaylist(track: Track) {
    if (view.type !== "playlist") return;
    await removeTrackFromPlaylist(view.id, track.id);
    await refreshPlaylistTracks(view.id);
  }

  function handleTrackSaved(updated: Track) {
    setTracks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
    setPlaylistTracks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  }

  if (authError) {
    return (
      <div className="flex h-screen items-center justify-center p-6 text-center text-sm text-red-400">
        {authError}
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-app-text-muted">
        Loading…
      </div>
    );
  }

  const activePlaylist =
    view.type === "playlist" ? playlists.find((p) => p.id === view.id) : undefined;

  return (
    <div className="flex h-screen flex-col">
      <div className="flex flex-1 overflow-hidden">
        <Sidebar view={view} playlists={playlists} onNavigate={setView} />
        <main className="flex-1 overflow-y-auto p-4 pb-6">
          {view.type === "library" && (
            <div className="flex flex-col gap-4">
              <h1 className="text-2xl font-bold">Your Library</h1>
              <TrackList
                tracks={tracks}
                playlists={playlists}
                emptyMessage="No tracks yet — forward an audio file to the bot to get started."
                onEdit={setEditingTrack}
                onAddToPlaylist={handleAddToPlaylist}
              />
            </div>
          )}
          {view.type === "playlists" && (
            <PlaylistsView
              playlists={playlists}
              onCreate={handleCreatePlaylist}
              onOpen={setView}
            />
          )}
          {view.type === "playlist" && activePlaylist && (
            <PlaylistDetailView
              playlist={activePlaylist}
              tracks={playlistTracks}
              playlists={playlists}
              onRename={(name) => handleRenamePlaylist(activePlaylist, name)}
              onDelete={() => handleDeletePlaylist(activePlaylist)}
              onEditTrack={setEditingTrack}
              onAddToPlaylist={handleAddToPlaylist}
              onRemoveFromPlaylist={handleRemoveFromPlaylist}
            />
          )}
        </main>
      </div>
      <NowPlayingBar />
      <BottomNav view={view} playlists={playlists} onNavigate={setView} />

      {editingTrack && (
        <TrackEditModal
          track={editingTrack}
          onClose={() => setEditingTrack(null)}
          onSaved={handleTrackSaved}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <PlayerProvider>
      <AppContent />
    </PlayerProvider>
  );
}
