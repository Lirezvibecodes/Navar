import { usePlayer } from "../context/PlayerContext";
import type { Playlist, Track } from "../types";
import { TrackRow } from "./TrackRow";

interface TrackListProps {
  tracks: Track[];
  playlists: Playlist[];
  emptyMessage: string;
  onEdit: (track: Track) => void;
  onAddToPlaylist: (track: Track, playlistId: string) => void;
  onRemoveFromPlaylist?: (track: Track) => void;
}

export function TrackList({
  tracks,
  playlists,
  emptyMessage,
  onEdit,
  onAddToPlaylist,
  onRemoveFromPlaylist,
}: TrackListProps) {
  const { currentTrack, isPlaying, play } = usePlayer();

  if (tracks.length === 0) {
    return <p className="px-3 py-6 text-sm text-app-text-muted">{emptyMessage}</p>;
  }

  return (
    <div className="flex flex-col gap-1">
      {tracks.map((track) => (
        <TrackRow
          key={track.id}
          track={track}
          isActive={currentTrack?.id === track.id}
          isPlaying={isPlaying}
          playlists={playlists}
          onPlay={() => play(track, tracks)}
          onEdit={() => onEdit(track)}
          onAddToPlaylist={(playlistId) => onAddToPlaylist(track, playlistId)}
          onRemoveFromPlaylist={
            onRemoveFromPlaylist ? () => onRemoveFromPlaylist(track) : undefined
          }
        />
      ))}
    </div>
  );
}
