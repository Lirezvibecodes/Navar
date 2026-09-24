import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  acceptJamRequest,
  addToJamQueue,
  cancelJamRequest,
  declineJamRequest,
  getJamState,
  leaveJam,
  moveJamQueueItem,
  removeFromJamQueue,
  removeJamParticipant,
  requestJam,
  syncJam,
} from "../api";
import type { JamPoll, JamRequest, JamView, Track } from "../types";
import { usePlayer } from "./PlayerContext";
import { useLibrary } from "./LibraryContext";
import { useToast } from "./ToastContext";
import { haptic } from "../telegram";

/**
 * Jam Mode on the client: one poll of `GET /api/jam`, and the bridge that
 * tells the player which way authority runs.
 *
 * Polling is bounded on purpose — there is no socket. While in a jam or
 * waiting on an answer it runs every few seconds; while playing publicly
 * (someone may ask to join) it runs slowly; otherwise it does not run at all
 * beyond a check on launch and whenever the app comes back to the front.
 */

const ACTIVE_POLL_MS = 3_000;
const HIDDEN_POLL_MS = 30_000;
/** A host with no jam yet: slow enough to cost nothing, quick enough that a request is seen. */
const IDLE_POLL_MS = 12_000;
/** Between reports while playing, so a guest joining mid-track lands close. */
const HOST_SYNC_MS = 20_000;

interface JamApi {
  jam: JamView | null;
  incoming: JamRequest[];
  outgoing: JamRequest | null;
  /** Server clock minus local clock, in ms. */
  skew: number;
  requestJoin: (hostId: string) => Promise<boolean>;
  cancelRequest: () => Promise<void>;
  accept: (id: string) => Promise<void>;
  decline: (id: string) => Promise<void>;
  leave: () => Promise<void>;
  removeParticipant: (userId: string) => Promise<void>;
  addToQueue: (track: Track, next?: boolean) => Promise<void>;
  removeQueueItem: (itemId: string) => Promise<void>;
  moveQueueItem: (itemId: string, toIndex: number) => Promise<void>;
  refresh: () => void;
}

const Ctx = createContext<JamApi | null>(null);

export function useJam(): JamApi {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useJam outside JamProvider");
  return ctx;
}

export function JamProvider({ children }: { children: React.ReactNode }) {
  const player = usePlayer();
  const { me } = useLibrary();
  const { toast, errorToast } = useToast();
  const { attachJam, followHost, currentTime, current, isPlaying, status, jamItemId, seekTick } = player;
  const listeningPublic = me?.listening_public ?? false;

  const [poll, setPoll] = useState<JamPoll | null>(null);
  const [skew, setSkew] = useState(0);
  const pollRef = useRef<JamPoll | null>(null);
  pollRef.current = poll;

  // Responses can land out of order (a slow poll behind a fast write), and the
  // later request is the one that knows more. Only the newest may be applied.
  const seq = useRef(0);
  const applied = useRef(0);
  const apply = useCallback((next: JamPoll, ticket: number) => {
    if (ticket < applied.current) return;
    applied.current = ticket;
    setSkew(Date.parse(next.server_now) - Date.now());
    setPoll(next);
  }, []);

  const [kick, setKick] = useState(0);
  const refresh = useCallback(() => setKick((k) => k + 1), []);

  const fetchNow = useCallback(async () => {
    const ticket = ++seq.current;
    try {
      apply(await getJamState(), ticket);
    } catch {
      // A missed poll is only a late one; the next tick tries again.
    }
  }, [apply]);

  const jam = poll?.jam ?? null;
  const outgoingPending = poll?.outgoing?.status === "pending";
  const mayBeAsked = listeningPublic && current != null && isPlaying;

  // One look on launch, whatever the pace: a jam or request may be waiting.
  useEffect(() => {
    void fetchNow();
  }, [fetchNow]);

  // The poll loop. Re-arms whenever what decides its pace changes, and also
  // polls at once whenever the app comes back to the front.
  useEffect(() => {
    let timer: number | undefined;
    let stopped = false;
    const pace = () => {
      if (jam || outgoingPending) return document.hidden ? HIDDEN_POLL_MS : ACTIVE_POLL_MS;
      if (mayBeAsked && !document.hidden) return IDLE_POLL_MS;
      return null;
    };
    const arm = () => {
      const ms = pace();
      if (ms != null) timer = window.setTimeout(loop, ms);
    };
    const loop = async () => {
      await fetchNow();
      if (!stopped) arm();
    };
    arm();
    const onFront = () => {
      if (document.hidden) return;
      window.clearTimeout(timer);
      void loop();
    };
    document.addEventListener("visibilitychange", onFront);
    window.addEventListener("focus", onFront);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onFront);
      window.removeEventListener("focus", onFront);
    };
  }, [jam != null, outgoingPending, mayBeAsked, fetchNow]); // eslint-disable-line react-hooks/exhaustive-deps

  // A refresh() asks for a poll now, whatever the loop's pace.
  useEffect(() => {
    if (kick > 0) void fetchNow();
  }, [kick, fetchNow]);

  /** Runs a write, applies the poll it answers with, and reports failures. */
  const write = useCallback(
    async (run: () => Promise<JamPoll>, fallback: string): Promise<boolean> => {
      const ticket = ++seq.current;
      try {
        apply(await run(), ticket);
        return true;
      } catch (err) {
        errorToast(err, fallback);
        void fetchNow();
        return false;
      }
    },
    [apply, errorToast, fetchNow]
  );

  // --- The bridge -----------------------------------------------------------
  // Declared before the follow effect so the player is in guest mode before
  // it is first asked to follow.

  const leavingRef = useRef(false);
  const role = jam?.role ?? null;
  const jamId = jam?.id ?? null;

  const leave = useCallback(async () => {
    leavingRef.current = true;
    haptic.press();
    const ok = await write(leaveJam, "Couldn't leave the jam");
    if (!ok) leavingRef.current = false;
  }, [write]);
  const leaveRef = useRef(leave);
  leaveRef.current = leave;

  const addToQueue = useCallback(
    async (track: Track, next = false) => {
      const ok = await write(() => addToJamQueue(track.id, next), "Couldn't add that to the jam");
      if (ok) {
        haptic.success();
        toast(next ? "Playing next in the jam" : "Added to the jam queue");
      }
    },
    [write, toast]
  );
  const addRef = useRef(addToQueue);
  addRef.current = addToQueue;

  const jamItemRef = useRef(jamItemId);
  jamItemRef.current = jamItemId;

  useEffect(() => {
    if (!jamId || !role) {
      attachJam(null);
      return;
    }
    attachJam({
      mode: role,
      nextShared: () => {
        const p = pollRef.current;
        const queue = p?.jam?.queue ?? [];
        const item = queue.find((q) => q.id !== jamItemRef.current && q.track.track != null);
        if (!item || !item.track.track || !p?.jam) return null;
        // Take it off locally so a quick second skip does not pick it again;
        // the sync that follows removes it on the server. Any poll already in
        // flight predates that, so it is retired too.
        const next = { ...p, jam: { ...p.jam, queue: queue.filter((q) => q.id !== item.id) } };
        applied.current = ++seq.current;
        pollRef.current = next;
        setPoll(next);
        return { track: item.track.track, itemId: item.id };
      },
      enqueue: (track, next) => void addRef.current(track, next),
      leave: () => void leaveRef.current(),
    });
  }, [jamId, role, attachJam]);

  // --- Guest: follow the host on every poll ----------------------------------

  const playback = jam?.role === "guest" ? jam.playback : null;
  useEffect(() => {
    if (!playback) return;
    followHost({
      track: playback.track,
      position: playback.position_seconds,
      atMs: Date.parse(playback.position_at) - skew,
      playing: playback.is_playing,
    });
  }, [playback, skew, followHost]);

  // --- Host: report playback --------------------------------------------------

  const hosting = jam?.role === "host";
  const sounding = status === "ready";
  useEffect(() => {
    if (!hosting) return;
    const send = () =>
      syncJam({
        trackId: current && status !== "unavailable" ? current.id : null,
        itemId: jamItemId,
        position: currentTime(),
        playing: isPlaying && sounding,
      }).catch(() => refresh());
    void send();
    if (!isPlaying) return;
    const timer = window.setInterval(send, HOST_SYNC_MS);
    return () => window.clearInterval(timer);
  }, [hosting, jamId, current?.id, jamItemId, isPlaying, sounding, seekTick]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Endings ------------------------------------------------------------------

  const prevJam = useRef<JamView | null>(null);
  useEffect(() => {
    const before = prevJam.current;
    prevJam.current = jam;
    if (!before || jam) return;
    if (leavingRef.current) {
      leavingRef.current = false;
      toast(before.role === "host" ? "Jam ended" : "You left the jam");
      return;
    }
    haptic.warning();
    toast(before.role === "host" ? "Everyone left the jam" : "The jam has ended");
  }, [jam, toast]);

  // --- Actions ----------------------------------------------------------------

  const requestJoin = useCallback(
    async (hostId: string) => {
      haptic.press();
      return write(() => requestJam(hostId), "Couldn't send the request");
    },
    [write]
  );

  const cancelRequest = useCallback(async () => {
    const id = pollRef.current?.outgoing?.id;
    if (!id) return;
    await write(() => cancelJamRequest(id), "Couldn't cancel the request");
  }, [write]);

  const accept = useCallback(
    async (id: string) => {
      haptic.success();
      await write(() => acceptJamRequest(id), "Couldn't accept the request");
    },
    [write]
  );

  const decline = useCallback(
    async (id: string) => {
      await write(() => declineJamRequest(id), "Couldn't decline the request");
    },
    [write]
  );

  const removeParticipant = useCallback(
    async (userId: string) => {
      await write(() => removeJamParticipant(userId), "Couldn't remove them");
    },
    [write]
  );

  const removeQueueItem = useCallback(
    async (itemId: string) => {
      await write(() => removeFromJamQueue(itemId), "Couldn't remove that song");
    },
    [write]
  );

  const moveQueueItem = useCallback(
    async (itemId: string, toIndex: number) => {
      await write(() => moveJamQueueItem(itemId, toIndex), "Couldn't move that song");
    },
    [write]
  );

  const value = useMemo<JamApi>(
    () => ({
      jam,
      incoming: poll?.incoming ?? [],
      outgoing: poll?.outgoing ?? null,
      skew,
      requestJoin,
      cancelRequest,
      accept,
      decline,
      leave,
      removeParticipant,
      addToQueue,
      removeQueueItem,
      moveQueueItem,
      refresh,
    }),
    [
      jam,
      poll,
      skew,
      requestJoin,
      cancelRequest,
      accept,
      decline,
      leave,
      removeParticipant,
      addToQueue,
      removeQueueItem,
      moveQueueItem,
      refresh,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
