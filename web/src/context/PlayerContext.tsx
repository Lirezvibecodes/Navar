import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Track } from "../types";
import { trackCoverUrl, trackStreamUrl } from "../api";
import {
  haptic,
  onActivationChange,
  setClosingConfirmation,
} from "../telegram";

/**
 * Playback, and the queue behind it.
 *
 * The queue has three parts, and keeping them apart is the whole design:
 *
 *   Now playing   — one track.
 *   Next in queue — tracks the user put there by hand. Always played first.
 *   Next from: X  — the rest of whatever they started from: a playlist, an
 *                   album, The Crate. Consumed only once the explicit queue
 *                   is empty, and replaced wholesale when they start
 *                   something else.
 *
 * A single flat list cannot express that. "Play next" would have to mutate the
 * playlist you are listening to, and starting a new album would have to decide
 * whether to discard the four songs you queued up by hand. Splitting them
 * means both questions answer themselves.
 */

export type RepeatMode = "off" | "all" | "one";

/** Where the automatic part of the queue is coming from, and what to call it. */
export interface PlaybackContextSource {
  /** Printed under "Next from:" and in the player header. */
  label: string;
  /** Stable identity, so restarting the same playlist does not reshuffle. */
  key: string;
  tracks: Track[];
}

const RESUME_KEY = "navaar.resume";
const PROGRESS_SAVE_MS = 5000;

interface ResumeState {
  trackId: string;
  position: number;
}

interface PlayerApi {
  current: Track | null;
  /** The hand-built queue, in play order. */
  upNext: Track[];
  /** What is left of the source, in play order, after the explicit queue. */
  contextNext: Track[];
  contextLabel: string | null;

  isPlaying: boolean;
  position: number;
  duration: number;
  shuffle: boolean;
  repeat: RepeatMode;
  /** Epoch ms at which playback stops, or null. */
  sleepAt: number | null;

  /** Start a source at one of its tracks. Replaces the context, keeps upNext. */
  playFrom: (source: PlaybackContextSource, track?: Track) => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (seconds: number) => void;

  /** Insert after the current track — never at absolute index 0. */
  queueNext: (track: Track) => void;
  queueLast: (track: Track) => void;
  removeFromQueue: (index: number) => void;
  moveInQueue: (from: number, to: number) => void;
  clearQueue: () => void;

  setShuffle: (on: boolean) => void;
  cycleRepeat: () => void;
  setSleepMinutes: (minutes: number | null) => void;

  /** Puts back the last track and position from a previous session. */
  restoreLast: (library: Track[]) => void;
}

const Ctx = createContext<PlayerApi | null>(null);

export function usePlayer(): PlayerApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePlayer outside PlayerProvider");
  return ctx;
}

function shuffled<T>(items: T[]): T[] {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [current, setCurrent] = useState<Track | null>(null);
  const [upNext, setUpNext] = useState<Track[]>([]);
  const [source, setSource] = useState<PlaybackContextSource | null>(null);
  /** The source's play order — the same list, shuffled, when shuffle is on. */
  const [order, setOrder] = useState<Track[]>([]);
  const [cursor, setCursor] = useState(-1);

  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [shuffle, setShuffleState] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  const [sleepAt, setSleepAt] = useState<number | null>(null);

  const contextNext = useMemo(
    () => (cursor >= 0 ? order.slice(cursor + 1) : []),
    [order, cursor]
  );

  // --- Loading a track ------------------------------------------------------

  const load = useCallback((track: Track | null, autoplay: boolean, at = 0) => {
    setCurrent(track);
    setPosition(at);
    setDuration(track?.duration_seconds ?? 0);

    const audio = audioRef.current;
    if (!audio) return;

    if (!track) {
      audio.removeAttribute("src");
      audio.load();
      setIsPlaying(false);
      return;
    }

    audio.src = trackStreamUrl(track.id);
    audio.currentTime = 0;
    if (at > 0) {
      // The stream is a Range proxy, so seeking before any data has arrived is
      // only honoured once the browser knows how long the file is.
      const seekOnce = () => {
        audio.currentTime = at;
        audio.removeEventListener("loadedmetadata", seekOnce);
      };
      audio.addEventListener("loadedmetadata", seekOnce);
    }
    if (autoplay) void audio.play().catch(() => setIsPlaying(false));
  }, []);

  // --- Advancing ------------------------------------------------------------

  const advance = useCallback(
    (auto: boolean) => {
      // Hand-queued tracks always win, whatever the source has left.
      if (upNext.length > 0) {
        const [head, ...rest] = upNext;
        setUpNext(rest);
        load(head, true);
        return;
      }

      if (cursor >= 0 && cursor + 1 < order.length) {
        setCursor(cursor + 1);
        load(order[cursor + 1], true);
        return;
      }

      if (repeat === "all" && order.length > 0) {
        setCursor(0);
        load(order[0], true);
        return;
      }

      // Nothing left. The track stays loaded so the bar does not vanish
      // mid-thought; it is simply paused at the end.
      if (auto) setIsPlaying(false);
    },
    [upNext, cursor, order, repeat, load]
  );

  const next = useCallback(() => {
    haptic.tap();
    advance(false);
  }, [advance]);

  const prev = useCallback(() => {
    haptic.tap();
    const audio = audioRef.current;
    // The universal transport convention: the first press restarts the track,
    // and only a second one within a few seconds goes back.
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      setPosition(0);
      return;
    }
    if (cursor > 0) {
      setCursor(cursor - 1);
      load(order[cursor - 1], true);
    } else if (audio) {
      audio.currentTime = 0;
      setPosition(0);
    }
  }, [cursor, order, load]);

  // --- Public actions -------------------------------------------------------

  const playFrom = useCallback(
    (nextSource: PlaybackContextSource, track?: Track) => {
      const playOrder = shuffle ? shuffled(nextSource.tracks) : nextSource.tracks;
      const start = track
        ? playOrder.findIndex((t) => t.id === track.id)
        : 0;
      const index = start < 0 ? 0 : start;

      setSource(nextSource);
      setOrder(playOrder);
      setCursor(index);
      load(playOrder[index] ?? null, true);
    },
    [shuffle, load]
  );

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !current) return;
    haptic.tap();
    if (audio.paused) void audio.play().catch(() => setIsPlaying(false));
    else audio.pause();
  }, [current]);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = seconds;
    setPosition(seconds);
  }, []);

  /**
   * Both queue actions start playback when nothing is playing. Queueing into
   * silence and having nothing happen is the kind of dead end that makes
   * people tap the button twice and end up with the track in there twice.
   */
  const queueNext = useCallback(
    (track: Track) => {
      if (!current) {
        playFrom({ label: "Queue", key: `queue:${track.id}`, tracks: [track] });
        return;
      }
      // Position 0 of the explicit queue is "after the track playing now",
      // which is what "play next" means. It is never an absolute index 0 of
      // some flattened list that would displace the current track.
      setUpNext((q) => [track, ...q.filter((t) => t.id !== track.id)]);
    },
    [current, playFrom]
  );

  const queueLast = useCallback(
    (track: Track) => {
      if (!current) {
        playFrom({ label: "Queue", key: `queue:${track.id}`, tracks: [track] });
        return;
      }
      setUpNext((q) => [...q.filter((t) => t.id !== track.id), track]);
    },
    [current, playFrom]
  );

  const removeFromQueue = useCallback((index: number) => {
    setUpNext((q) => q.filter((_, i) => i !== index));
  }, []);

  const moveInQueue = useCallback((from: number, to: number) => {
    setUpNext((q) => {
      if (from === to || from < 0 || from >= q.length) return q;
      const copy = q.slice();
      const [item] = copy.splice(from, 1);
      copy.splice(Math.max(0, Math.min(copy.length, to)), 0, item);
      return copy;
    });
  }, []);

  const clearQueue = useCallback(() => setUpNext([]), []);

  const setShuffle = useCallback(
    (on: boolean) => {
      setShuffleState(on);
      if (!source) return;
      // Reshuffling keeps whatever is playing where it is and rearranges the
      // rest, so turning shuffle on does not jump you to another song.
      const rest = source.tracks.filter((t) => t.id !== current?.id);
      const reordered = on ? shuffled(rest) : source.tracks;
      const nextOrder = on && current ? [current, ...reordered] : reordered;
      setOrder(nextOrder);
      setCursor(
        current ? Math.max(0, nextOrder.findIndex((t) => t.id === current.id)) : 0
      );
    },
    [source, current]
  );

  const cycleRepeat = useCallback(() => {
    haptic.select();
    setRepeat((mode) => (mode === "off" ? "all" : mode === "all" ? "one" : "off"));
  }, []);

  const setSleepMinutes = useCallback((minutes: number | null) => {
    setSleepAt(minutes == null ? null : Date.now() + minutes * 60_000);
  }, []);

  // --- Audio element wiring -------------------------------------------------

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTime = () => setPosition(audio.currentTime);
    const onMeta = () => {
      if (Number.isFinite(audio.duration)) setDuration(audio.duration);
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      if (repeat === "one") {
        audio.currentTime = 0;
        void audio.play().catch(() => setIsPlaying(false));
        return;
      }
      advance(true);
    };

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
    };
  }, [advance, repeat]);

  // Confirm before closing only while something is actually playing. A stray
  // swipe should not end a song; confirming an exit the user meant is friction.
  useEffect(() => {
    setClosingConfirmation(isPlaying);
  }, [isPlaying]);

  // --- Sleep timer ----------------------------------------------------------

  useEffect(() => {
    if (sleepAt == null) return;
    const remaining = sleepAt - Date.now();
    if (remaining <= 0) {
      audioRef.current?.pause();
      setSleepAt(null);
      return;
    }
    const timer = window.setTimeout(() => {
      audioRef.current?.pause();
      setSleepAt(null);
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [sleepAt]);

  // --- Media Session --------------------------------------------------------

  useEffect(() => {
    const ms = navigator.mediaSession;
    if (!ms) return;

    if (!current) {
      ms.metadata = null;
      return;
    }

    ms.metadata = new MediaMetadata({
      title: current.title ?? "Untitled",
      artist: current.artist ?? "Unknown artist",
      album: current.album ?? undefined,
      artwork: current.has_cover
        ? [{ src: trackCoverUrl(current.id), sizes: "512x512" }]
        : [],
    });
  }, [current]);

  useEffect(() => {
    const ms = navigator.mediaSession;
    if (!ms) return;
    ms.playbackState = isPlaying ? "playing" : "paused";
  }, [isPlaying]);

  useEffect(() => {
    const ms = navigator.mediaSession;
    if (!ms) return;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ["play", () => void audioRef.current?.play()],
      ["pause", () => audioRef.current?.pause()],
      ["previoustrack", prev],
      ["nexttrack", next],
      [
        "seekto",
        (details) => {
          if (typeof details.seekTime === "number") seek(details.seekTime);
        },
      ],
    ];
    for (const [action, handler] of handlers) {
      try {
        ms.setActionHandler(action, handler);
      } catch {
        // Not every WebView implements every action.
      }
    }
    return () => {
      for (const [action] of handlers) {
        try {
          ms.setActionHandler(action, null);
        } catch {
          /* as above */
        }
      }
    };
  }, [prev, next, seek]);

  // --- Resume ---------------------------------------------------------------

  const rememberPosition = useCallback(() => {
    const audio = audioRef.current;
    if (!current || !audio) return;
    const state: ResumeState = { trackId: current.id, position: audio.currentTime };
    try {
      localStorage.setItem(RESUME_KEY, JSON.stringify(state));
    } catch {
      // Private mode, or a full quota. Losing the resume point is survivable.
    }
  }, [current]);

  // Written on a slow interval as well as on the way out, because a WebView
  // that is killed while backgrounded never gets to run its teardown.
  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(rememberPosition, PROGRESS_SAVE_MS);
    return () => window.clearInterval(timer);
  }, [isPlaying, rememberPosition]);

  useEffect(() => {
    // Telegram tells us when the Mini App stops being the thing on screen.
    // Recording the position is all that happens here: the WebView is
    // suspended either way, so there is no background playback to preserve
    // and no toggle in the app that pretends otherwise.
    return onActivationChange((active) => {
      if (!active) rememberPosition();
    });
  }, [rememberPosition]);

  useEffect(() => {
    window.addEventListener("pagehide", rememberPosition);
    return () => window.removeEventListener("pagehide", rememberPosition);
  }, [rememberPosition]);

  const restored = useRef(false);
  const restoreLast = useCallback(
    (library: Track[]) => {
      if (restored.current || library.length === 0) return;
      restored.current = true;

      let saved: ResumeState | null = null;
      try {
        const raw = localStorage.getItem(RESUME_KEY);
        saved = raw ? (JSON.parse(raw) as ResumeState) : null;
      } catch {
        saved = null;
      }
      if (!saved) return;

      const track = library.find((t) => t.id === saved!.trackId);
      if (!track) return;

      // Loaded, positioned, and paused. Coming back to the app should not
      // start making noise on its own.
      setSource({ label: "Your library", key: "library", tracks: library });
      setOrder(library);
      setCursor(library.findIndex((t) => t.id === track.id));
      load(track, false, saved.position);
    },
    [load]
  );

  const api = useMemo<PlayerApi>(
    () => ({
      current,
      upNext,
      contextNext,
      contextLabel: source?.label ?? null,
      isPlaying,
      position,
      duration,
      shuffle,
      repeat,
      sleepAt,
      playFrom,
      toggle,
      next,
      prev,
      seek,
      queueNext,
      queueLast,
      removeFromQueue,
      moveInQueue,
      clearQueue,
      setShuffle,
      cycleRepeat,
      setSleepMinutes,
      restoreLast,
    }),
    [
      current,
      upNext,
      contextNext,
      source,
      isPlaying,
      position,
      duration,
      shuffle,
      repeat,
      sleepAt,
      playFrom,
      toggle,
      next,
      prev,
      seek,
      queueNext,
      queueLast,
      removeFromQueue,
      moveInQueue,
      clearQueue,
      setShuffle,
      cycleRepeat,
      setSleepMinutes,
      restoreLast,
    ]
  );

  return (
    <Ctx.Provider value={api}>
      {children}
      <audio ref={audioRef} preload="metadata" />
    </Ctx.Provider>
  );
}
