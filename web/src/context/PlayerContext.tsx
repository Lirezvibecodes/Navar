import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { trackStreamUrl } from "../api";
import type { Track } from "../types";

interface PlayerState {
  currentTrack: Track | null;
  queue: Track[];
  isPlaying: boolean;
  progress: number;
  duration: number;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  play: (track: Track, queue?: Track[]) => void;
  togglePlay: () => void;
  next: () => void;
  prev: () => void;
  seek: (seconds: number) => void;
}

const PlayerContext = createContext<PlayerState | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  const play = useCallback((track: Track, newQueue?: Track[]) => {
    if (newQueue) setQueue(newQueue);
    setCurrentTrack(track);
    setIsPlaying(true);
    requestAnimationFrame(() => {
      const audio = audioRef.current;
      if (!audio) return;
      audio.src = trackStreamUrl(track.id);
      audio.play().catch(() => {});
    });
  }, []);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().catch(() => {});
      setIsPlaying(true);
    }
  }, [currentTrack, isPlaying]);

  const stepQueue = useCallback(
    (direction: 1 | -1) => {
      if (!currentTrack || queue.length === 0) return;
      const index = queue.findIndex((t) => t.id === currentTrack.id);
      if (index === -1) return;
      const nextIndex = (index + direction + queue.length) % queue.length;
      play(queue[nextIndex], queue);
    },
    [currentTrack, queue, play]
  );

  const next = useCallback(() => stepQueue(1), [stepQueue]);
  const prev = useCallback(() => stepQueue(-1), [stepQueue]);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = seconds;
    setProgress(seconds);
  }, []);

  const value = useMemo<PlayerState>(
    () => ({
      currentTrack,
      queue,
      isPlaying,
      progress,
      duration,
      audioRef,
      play,
      togglePlay,
      next,
      prev,
      seek,
    }),
    [currentTrack, queue, isPlaying, progress, duration, play, togglePlay, next, prev, seek]
  );

  return (
    <PlayerContext.Provider value={value}>
      {children}
      <audio
        ref={audioRef}
        onTimeUpdate={(e) => setProgress(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onEnded={next}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
      />
    </PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerState {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error("usePlayer must be used within PlayerProvider");
  return ctx;
}
