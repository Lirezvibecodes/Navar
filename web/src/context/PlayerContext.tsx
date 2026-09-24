import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { JamTrack, Track } from "../types";
import {
  recordPlay,
  setListeningStatus,
  trackCoverUrl,
  trackStreamUrl,
} from "../api";
import { useLibrary } from "./LibraryContext";
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
/** Comfortably inside the five minutes the server gives a live status. */
const STATUS_HEARTBEAT_MS = 2 * 60_000;
/** How far a jam guest may wander from the host before being put back. */
const JAM_DRIFT_SECONDS = 1.5;
/** How much of a track has to be heard before it counts as played. */
const PLAY_LOG_SECONDS = 30;

/**
 * What the audio element is doing, beyond playing or paused.
 *
 * The element can fail in ways that look exactly like a pause: a Telegram file
 * id that has expired, a proxy that 404s, a phone that lost signal halfway
 * through a stream. Before this existed all three paths ended in
 * `.catch(() => setIsPlaying(false))` and the app drew a play button, so the
 * user pressed it again, and again. `failed` is what lets the UI say so.
 *
 * `unavailable` is a jam guest's: the host is playing something this listener
 * could not open on their own, so there is a title to show and nothing to play.
 */
export type PlaybackStatus = "idle" | "loading" | "ready" | "failed" | "unavailable";

interface ResumeState {
  trackId: string;
  position: number;
}

/**
 * Jam Mode, as far as the player is concerned.
 *
 * The jam itself — polling, requests, the shared queue — lives in JamContext.
 * The player only needs to know which way authority runs: a host plays as
 * usual but draws on the shared queue first, and a guest plays nothing of
 * their own and follows the host. The bridge is how JamContext tells it.
 */
export type JamMode = "solo" | "host" | "guest";

export interface JamBridge {
  mode: "host" | "guest";
  /** Host only: take the next shared-queue item, or null when it is empty. */
  nextShared: () => { track: Track; itemId: string } | null;
  /** Queue actions go to the shared queue while in a jam. */
  enqueue: (track: Track, next: boolean) => void;
  /** A guest started something of their own, which means leaving. */
  leave: () => void;
}

/** What the host is doing, as a guest's client last heard it. */
export interface HostPlayback {
  track: JamTrack | null;
  position: number;
  /** Local clock time at which `position` was true. */
  atMs: number;
  playing: boolean;
}

interface SoloSnapshot {
  current: Track | null;
  upNext: Track[];
  source: PlaybackContextSource | null;
  order: Track[];
  cursor: number;
  position: number;
}

/** Something to show for a track the guest may not play: its name and nothing else. */
function unavailableTrack(jt: JamTrack): Track {
  return {
    id: jt.id,
    owner_telegram_id: "",
    title: jt.title,
    artist: jt.artist,
    album: null,
    duration_seconds: jt.duration_seconds,
    telegram_file_id: "",
    mime_type: null,
    has_cover: jt.cover_track_id != null,
    origin_adder_id: null,
    favorited_at: null,
    has_lyrics: false,
    created_at: "",
  };
}

interface PlayerApi {
  current: Track | null;
  /** The hand-built queue, in play order. */
  upNext: Track[];
  /** What is left of the source, in play order, after the explicit queue. */
  contextNext: Track[];
  contextLabel: string | null;

  isPlaying: boolean;
  /** Buffering, playable, or broken. See PlaybackStatus. */
  status: PlaybackStatus;
  position: number;
  duration: number;
  shuffle: boolean;
  repeat: RepeatMode;
  /** Epoch ms at which playback stops, or null. */
  sleepAt: number | null;

  /**
   * Start a source at one of its tracks. Replaces the context, keeps upNext.
   *
   * `shuffleOverride` decides the order this call plays in *and* becomes the
   * new shuffle state — pass it when the shuffle toggle and the play action
   * happen together (the Shuffle button), so the order is never built from a
   * `shuffle` flag that hasn't re-rendered yet.
   */
  playFrom: (source: PlaybackContextSource, track?: Track, shuffleOverride?: boolean) => void;
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

  /**
   * Jump straight to a track sitting further down `upNext`. Only that track
   * leaves the queue — everything else stays put in its own order, the same
   * way tapping a track in Spotify's or Apple Music's queue doesn't clear out
   * whatever else was waiting.
   */
  playFromUpNext: (index: number) => void;
  /** Same, for a track further down `contextNext`. */
  playFromContextNext: (track: Track) => void;

  setShuffle: (on: boolean) => void;
  cycleRepeat: () => void;
  setSleepMinutes: (minutes: number | null) => void;

  /** Fetches the current track again from where it stopped. */
  retry: () => void;

  /** Puts back the last track and position from a previous session. */
  restoreLast: (library: Track[]) => void;

  jamMode: JamMode;
  /** The shared-queue row the host is playing, if it came from there. */
  jamItemId: string | null;
  /** Bumped on every seek, so a host can report a jump the moment it happens. */
  seekTick: number;
  /** The element's own position, which `position` only samples. */
  currentTime: () => number;
  /** JamContext's hook in. Entering guest mode sets solo playback aside; leaving puts it back, paused. */
  attachJam: (bridge: JamBridge | null) => void;
  /** Guest only: line up with the host. */
  followHost: (target: HostPlayback) => void;
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
  const [status, setStatus] = useState<PlaybackStatus>("idle");
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [shuffle, setShuffleState] = useState(false);
  const [repeat, setRepeat] = useState<RepeatMode>("off");
  const [sleepAt, setSleepAt] = useState<number | null>(null);

  const [jamMode, setJamMode] = useState<JamMode>("solo");
  const [jamItemId, setJamItemId] = useState<string | null>(null);
  const [seekTick, setSeekTick] = useState(0);
  const bridgeRef = useRef<JamBridge | null>(null);
  const soloSnapshot = useRef<SoloSnapshot | null>(null);
  /** A guest who paused their own ear; the host's next play doesn't override it. */
  const guestHeld = useRef(false);
  const lastHost = useRef<HostPlayback | null>(null);
  // Read by the jam callbacks below, which are handed to JamContext once and
  // must not capture the state of the render they were made in.
  const live = useRef({ current, upNext, source, order, cursor, status });
  live.current = { current, upNext, source, order, cursor, status };
  const isGuest = () => bridgeRef.current?.mode === "guest";

  // A track already sitting in the explicit queue doesn't also show up here —
  // it would otherwise appear twice, once as something you queued and once as
  // "coming up anyway", which reads as the app not knowing its own queue.
  const contextNext = useMemo(() => {
    const rest = cursor >= 0 ? order.slice(cursor + 1) : [];
    if (upNext.length === 0) return rest;
    const queued = new Set(upNext.map((t) => t.id));
    return rest.filter((t) => !queued.has(t.id));
  }, [order, cursor, upNext]);

  // --- Loading a track ------------------------------------------------------

  /**
   * play() rejects for three quite different reasons and they must not be
   * treated alike: the autoplay policy refused (the user only has to press
   * play), a second load replaced this one mid-flight (nothing is wrong), or
   * the media itself is unplayable. Only the last one sets an error object on
   * the element, so that is what decides whether the UI calls it a failure.
   */
  const playAudio = useCallback((audio: HTMLAudioElement) => {
    void audio.play().catch(() => {
      setIsPlaying(false);
      if (audio.error) setStatus("failed");
    });
  }, []);

  const load = useCallback((track: Track | null, autoplay: boolean, at = 0, itemId: string | null = null) => {
    setCurrent(track);
    setJamItemId(itemId);
    setPosition(at);
    setDuration(track?.duration_seconds ?? 0);

    const audio = audioRef.current;
    if (!audio) return;

    if (!track) {
      audio.removeAttribute("src");
      audio.load();
      setIsPlaying(false);
      setStatus("idle");
      return;
    }

    setStatus("loading");

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
    if (autoplay) playAudio(audio);
  }, [playAudio]);

  // --- Advancing ------------------------------------------------------------

  const advance = useCallback(
    (auto: boolean) => {
      const bridge = bridgeRef.current;
      // A guest's next track is whatever the host plays next.
      if (bridge?.mode === "guest") {
        if (auto) setIsPlaying(false);
        return;
      }
      // A host's jam queue comes before their own, which waits underneath it.
      const shared = bridge?.nextShared();
      if (shared) {
        load(shared.track, true, 0, shared.itemId);
        return;
      }

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
    if (isGuest()) return;
    haptic.tap();
    advance(false);
  }, [advance]);

  const prev = useCallback(() => {
    if (isGuest()) return;
    haptic.tap();
    const audio = audioRef.current;
    // The universal transport convention: the first press restarts the track,
    // and only a second one within a few seconds goes back.
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      setPosition(0);
      setSeekTick((n) => n + 1);
      return;
    }
    if (cursor > 0) {
      setCursor(cursor - 1);
      load(order[cursor - 1], true);
    } else if (audio) {
      audio.currentTime = 0;
      setPosition(0);
      setSeekTick((n) => n + 1);
    }
  }, [cursor, order, load]);

  // --- Public actions -------------------------------------------------------

  const playFrom = useCallback(
    (nextSource: PlaybackContextSource, track?: Track, shuffleOverride?: boolean) => {
      // A guest picking their own music is leaving the jam. What they picked
      // wins over the solo state set aside on the way in, so that is dropped
      // before the bridge can put it back.
      const bridge = bridgeRef.current;
      if (bridge?.mode === "guest") {
        soloSnapshot.current = null;
        bridgeRef.current = null;
        lastHost.current = null;
        setJamMode("solo");
        bridge.leave();
      }
      const useShuffle = shuffleOverride ?? shuffle;
      if (shuffleOverride !== undefined) setShuffleState(shuffleOverride);
      const playOrder = useShuffle ? shuffled(nextSource.tracks) : nextSource.tracks;
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
    if (isGuest()) {
      // A guest can take their own ear out and put it back, nothing more.
      // Coming back goes through followHost so it lands where the host is now.
      guestHeld.current = !audio.paused;
      if (audio.paused && lastHost.current) followHostRef.current(lastHost.current);
      else if (!audio.paused) audio.pause();
      return;
    }
    if (audio.paused) playAudio(audio);
    else audio.pause();
  }, [current, playAudio]);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio || isGuest()) return;
    audio.currentTime = seconds;
    setPosition(seconds);
    setSeekTick((n) => n + 1);
  }, []);

  /**
   * Both queue actions start playback when nothing is playing. Queueing into
   * silence and having nothing happen is the kind of dead end that makes
   * people tap the button twice and end up with the track in there twice.
   */
  const queueNext = useCallback(
    (track: Track) => {
      if (bridgeRef.current) {
        bridgeRef.current.enqueue(track, true);
        return;
      }
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
      if (bridgeRef.current) {
        bridgeRef.current.enqueue(track, false);
        return;
      }
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

  const playFromUpNext = useCallback(
    (index: number) => {
      const track = upNext[index];
      if (!track) return;
      // Only the tapped track leaves — everything else waiting in the queue
      // stays right where it was.
      setUpNext(upNext.filter((_, i) => i !== index));
      load(track, true);
    },
    [upNext, load]
  );

  const playFromContextNext = useCallback(
    (track: Track) => {
      // contextNext is order.slice(cursor + 1) with anything already in
      // upNext filtered out, so its own index no longer lines up with a
      // position in order — find the track itself, past the cursor.
      const absolute = order.findIndex((t, i) => i > cursor && t.id === track.id);
      if (absolute === -1) return;
      setCursor(absolute);
      load(track, true);
    },
    [cursor, order, load]
  );

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

  /**
   * Assigning src again always restarts the resource selection algorithm, even
   * to the same URL — which is the point, because the usual cause of a failure
   * here is a Telegram file id the server has since refreshed.
   */
  const retry = useCallback(() => {
    if (!current) return;
    haptic.tap();
    if (isGuest()) {
      // Wherever the host has got to by now, not where this one broke.
      if (lastHost.current) {
        guestHeld.current = false;
        live.current.status = "idle";
        followHostRef.current(lastHost.current);
      }
      return;
    }
    load(current, true, position, jamItemId);
  }, [current, position, jamItemId, load]);

  // --- Jam ------------------------------------------------------------------

  const attachJam = useCallback(
    (bridge: JamBridge | null) => {
      const was = bridgeRef.current?.mode ?? "solo";
      const now = bridge?.mode ?? "solo";
      bridgeRef.current = bridge;
      setJamMode(now);
      if (was === now) return;

      const audio = audioRef.current;
      if (now === "guest") {
        // Set the listener's own session aside whole, so leaving gives it back
        // exactly — their queue included, which the jam never touches.
        const s = live.current;
        soloSnapshot.current = {
          current: s.status === "unavailable" ? null : s.current,
          upNext: s.upNext,
          source: s.source,
          order: s.order,
          cursor: s.cursor,
          position: audio?.currentTime ?? 0,
        };
        guestHeld.current = false;
        setUpNext([]);
        audio?.pause();
        return;
      }

      if (was === "guest") {
        const snap = soloSnapshot.current;
        soloSnapshot.current = null;
        lastHost.current = null;
        guestHeld.current = false;
        if (!snap) return;
        setUpNext(snap.upNext);
        setSource(snap.source);
        setOrder(snap.order);
        setCursor(snap.cursor);
        // Back where they were, and quiet: the jam ending is not a reason for
        // the phone to start playing something else on its own.
        load(snap.current, false, snap.position);
      }
    },
    [load]
  );

  const followHost = useCallback(
    (target: HostPlayback) => {
      if (!isGuest()) return;
      lastHost.current = target;
      const audio = audioRef.current;
      if (!audio) return;
      const jt = target.track;
      if (!jt) {
        // The host is between tracks. Stay on the last one, stopped.
        audio.pause();
        return;
      }

      const length = jt.duration_seconds ?? Infinity;
      const at = Math.max(
        0,
        Math.min(
          length,
          target.playing ? target.position + (Date.now() - target.atMs) / 1000 : target.position
        )
      );
      const { current: shown, status: shownStatus } = live.current;

      if (!jt.available || !jt.track) {
        if (shown?.id !== jt.id || shownStatus !== "unavailable") {
          audio.pause();
          audio.removeAttribute("src");
          audio.load();
          setCurrent(unavailableTrack(jt));
          setJamItemId(null);
          setDuration(jt.duration_seconds ?? 0);
          setIsPlaying(false);
          setStatus("unavailable");
          live.current.status = "unavailable";
        }
        setPosition(at);
        return;
      }

      const shouldPlay = target.playing && !guestHeld.current;
      if (shown?.id !== jt.id || shownStatus === "unavailable" || shownStatus === "idle") {
        load(jt.track, shouldPlay, at);
        live.current.status = "loading";
        return;
      }
      // Mid-load, the element's clock is still at zero; the seek queued by
      // load() lands on its own, and the next poll checks the result.
      if (shownStatus === "ready" && Math.abs(audio.currentTime - at) > JAM_DRIFT_SECONDS) {
        audio.currentTime = at;
        setPosition(at);
      }
      if (shouldPlay && audio.paused && shownStatus !== "failed") playAudio(audio);
      if (!shouldPlay && !audio.paused) audio.pause();
    },
    [load, playAudio]
  );
  // toggle and retry come back through here, and are made before it is.
  const followHostRef = useRef(followHost);
  followHostRef.current = followHost;

  const currentTime = useCallback(() => audioRef.current?.currentTime ?? 0, []);

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
    // `playing` is the only event that means sound is actually coming out;
    // `canplay` means enough has arrived to start. Either clears a spinner.
    const onReady = () => setStatus("ready");
    // Both fire when the buffer runs dry mid-stream, which on a phone changing
    // cells is a routine event and not a failure — it just needs to say so.
    const onWaiting = () => setStatus("loading");
    const onError = () => {
      setStatus("failed");
      setIsPlaying(false);
    };
    const onEnded = () => {
      if (isGuest()) return;
      if (repeat === "one") {
        audio.currentTime = 0;
        playAudio(audio);
        return;
      }
      advance(true);
    };

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("playing", onReady);
    audio.addEventListener("canplay", onReady);
    audio.addEventListener("waiting", onWaiting);
    audio.addEventListener("stalled", onWaiting);
    audio.addEventListener("error", onError);
    audio.addEventListener("ended", onEnded);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("playing", onReady);
      audio.removeEventListener("canplay", onReady);
      audio.removeEventListener("waiting", onWaiting);
      audio.removeEventListener("stalled", onWaiting);
      audio.removeEventListener("error", onError);
      audio.removeEventListener("ended", onEnded);
    };
  }, [advance, repeat, playAudio]);

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

  // --- Reporting ------------------------------------------------------------
  //
  // Two things leave for the server while music plays, and neither is allowed
  // to matter: a status friends may be shown, and a play for your own history.
  // Both are fire-and-forget. Nothing on screen reads either of them back, so
  // a failed one is not retried and never becomes a message.

  const { me, tracks } = useLibrary();
  const listeningPublic = me?.listening_public ?? false;

  /**
   * `current` is a snapshot taken when a track starts playing, so a heart or an
   * edit made anywhere else in the app — the Crate, a playlist, the player's
   * own heart button — would otherwise sit invisible on this screen until the
   * next track loads and replaces it. Library rows keep their identity across
   * an update (see `putTrack`), so a reference change here means the row
   * genuinely changed and the player should pick it up; nothing else re-runs
   * this on every unrelated library edit.
   */
  useEffect(() => {
    if (!current) return;
    const fresh = tracks.find((t) => t.id === current.id);
    if (fresh && fresh !== current) setCurrent(fresh);
  }, [tracks, current]);

  /**
   * What you are playing, where in it, and whether it is moving.
   *
   * Sent only when the switch on your profile is on, so an account that never
   * turns it on never spends a request on it — and turning it on reports at
   * once, because this effect re-runs on the flag. It reports on a track
   * change, a play, a seek, the moment buffering gives way to sound, and a
   * pause that follows a reported play, which is what lets a friend's profile
   * draw a live progress line and take it away when you stop. None of that is
   * load-bearing: a Mini App swiped away never sends a goodbye, so a status
   * still disappears on its own once the server-side window closes over it.
   */
  const reportedPlaying = useRef(false);
  const sounding = status === "ready";
  useEffect(() => {
    if (!listeningPublic || !current || status === "unavailable") return;
    if (!isPlaying && !reportedPlaying.current) return;
    const id = current.id;
    const report = () => {
      reportedPlaying.current = isPlaying;
      void setListeningStatus(id, audioRef.current?.currentTime ?? 0, isPlaying).catch(() => {});
    };
    report();
    if (!isPlaying) return;
    const timer = window.setInterval(report, STATUS_HEARTBEAT_MS);
    return () => window.clearInterval(timer);
    // `status` itself is read only for "unavailable"; `sounding` is the edge
    // that matters, and following every loading flicker would double the requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listeningPublic, current, isPlaying, seekTick, sounding]);

  /**
   * One play per track, once it has genuinely been listened to.
   *
   * The timer is armed by playback and disarmed by a pause, so skipping
   * through six songs looking for one logs nothing. Seeking is invisible to it
   * by construction rather than by a guard: the position is not an input.
   * Short tracks count at their halfway mark, or they could never count at all.
   */
  const lastLogged = useRef<string | null>(null);
  useEffect(() => {
    if (!current || !isPlaying || lastLogged.current === current.id) return;
    const id = current.id;
    const length = current.duration_seconds ?? PLAY_LOG_SECONDS * 2;
    const after = Math.max(5, Math.min(PLAY_LOG_SECONDS, length / 2));
    const timer = window.setTimeout(() => {
      lastLogged.current = id;
      void recordPlay(id).catch(() => {
        // Leave it eligible again, in case this track is still the one playing.
        if (lastLogged.current === id) lastLogged.current = null;
      });
    }, after * 1000);
    return () => window.clearTimeout(timer);
  }, [current, isPlaying]);

  // --- Resume ---------------------------------------------------------------

  const rememberPosition = useCallback(() => {
    const audio = audioRef.current;
    // A guest is playing the host's music; what to resume is what was set aside.
    if (!current || !audio || isGuest()) return;
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
      status,
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
      playFromUpNext,
      playFromContextNext,
      setShuffle,
      cycleRepeat,
      setSleepMinutes,
      retry,
      restoreLast,
      jamMode,
      jamItemId,
      seekTick,
      currentTime,
      attachJam,
      followHost,
    }),
    [
      jamMode,
      jamItemId,
      seekTick,
      currentTime,
      attachJam,
      followHost,
      current,
      upNext,
      contextNext,
      source,
      isPlaying,
      status,
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
      playFromUpNext,
      playFromContextNext,
      setShuffle,
      cycleRepeat,
      setSleepMinutes,
      retry,
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
