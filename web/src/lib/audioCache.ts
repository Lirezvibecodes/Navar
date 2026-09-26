import { useSyncExternalStore } from "react";
import { trackCoverUrl, trackStreamUrl } from "../api";
import type { Track } from "../types";

/**
 * Songs kept on the phone, so a replay starts at once and a song you have
 * already heard plays on a bad connection, or none.
 *
 * The files live in IndexedDB as Blobs. Both WebKit and Chromium keep a
 * stored Blob on disk and hand back a file-backed handle, so opening the
 * cache does not pull a library's worth of audio into memory.
 *
 * Why a synchronous lookup at all: iOS only lets audio start inside the tap
 * that asked for it. Anything awaited between the tap and audio.play() —
 * even one IndexedDB read — loses the gesture and the play is refused. So the
 * handles are read once at startup and turned into object URLs up front, and
 * `cachedUrl` answers from memory in the same tick as the tap.
 *
 * The cache is a courtesy, never the authority. Every failure here — no
 * IndexedDB, a quota error, a download cut off halfway — falls back to
 * streaming exactly as the app did before this existed.
 *
 * Two kinds of song live here. Inside Telegram, songs are saved as they are
 * played (saveTrack) and the oldest make room for new ones. In the installed
 * web app nothing is saved unasked: songs are downloaded on purpose
 * (downloadTracks), marked `pinned`, and never evicted to make room — only
 * the person deleting them removes them. A download also keeps the track's
 * details, so "On this phone" can list it with no connection and without the
 * library it came from (a friend's playlist, say).
 */

const DB_NAME = "navaar-audio";
const STORE = "tracks";

/** Never hold more than this many songs, whatever the quota says. */
const MAX_TRACKS = 150;
/** Used when the browser will not say how much room there is. */
const FALLBACK_BUDGET_BYTES = 400 * 1024 * 1024;
/** Take at most this share of the origin's quota, and never more than the cap. */
const QUOTA_SHARE = 0.5;
const MAX_BUDGET_BYTES = 1500 * 1024 * 1024;

interface Row {
  id: string;
  blob: Blob;
  size: number;
  lastPlayed: number;
  pinned?: boolean;
  track?: Track;
}

interface Meta {
  url: string;
  size: number;
  lastPlayed: number;
  pinned: boolean;
  track: Track | null;
}

const entries = new Map<string, Meta>();
const inflight = new Map<string, Promise<void>>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

/** Rows showing the "saved on this phone" mark re-render when this fires. */
const listeners = new Set<() => void>();
let stats: CacheStats = { count: 0, bytes: 0 };
let savedTracks: Track[] = [];
function changed(): void {
  let bytes = 0;
  for (const meta of entries.values()) bytes += meta.size;
  // New objects only when something moved, so useSyncExternalStore sees a
  // stable snapshot between changes.
  stats = { count: entries.size, bytes };
  savedTracks = [...entries.values()]
    .filter((m) => m.track)
    .sort((a, b) => b.lastPlayed - a.lastPlayed)
    .map((m) => m.track!);
  for (const listener of listeners) listener();
}

/** Every saved song whose details were kept, most recently played first. */
export function useSavedTracks(): Track[] {
  return useSyncExternalStore(subscribe, () => savedTracks);
}

export interface CacheStats {
  count: number;
  bytes: number;
}

/** How many songs are saved here and how much room they take. */
export function useAudioCacheStats(): CacheStats {
  return useSyncExternalStore(subscribe, () => stats);
}

// --- The switch in Settings --------------------------------------------------
//
// Per phone, like the cache itself, so it lives in localStorage rather than on
// the account. Off stops new songs being saved or fetched ahead; songs already
// saved still play until they are cleared, so each control does one thing.

const ENABLED_KEY = "navaar-save-songs";
let enabled = readEnabled();

function readEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== "off";
  } catch {
    return true;
  }
}

export function useSavingEnabled(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, () => enabled);
  return [on, setSavingEnabled];
}

export function setSavingEnabled(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(ENABLED_KEY, on ? "on" : "off");
  } catch {
    // Remembered for this session only.
  }
  changed();
}

/**
 * Forgets every saved song. The object URLs are deliberately not revoked: the
 * song playing right now may be one of them, and pulling its URL out from
 * under the audio element would cut it off mid-track. They are released when
 * the app closes.
 */
export async function clearAudioCache(): Promise<void> {
  entries.clear();
  queue.length = 0;
  downloadState.clear();
  changed();
  const db = await openDb();
  if (!db) return;
  try {
    await tx(db, "readwrite", (s) => void s.clear());
  } catch {
    // Whatever is left is dropped by eviction in time.
  }
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether a song is saved on this phone, kept current as songs come and go. */
export function useIsCached(trackId: string): boolean {
  return useSyncExternalStore(subscribe, () => entries.has(trackId));
}
let budgetBytes = FALLBACK_BUDGET_BYTES;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function tx<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T> | void
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

let ready: Promise<void> | null = null;

/** Reads what is already saved. Safe to call more than once. */
export function initAudioCache(): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    const db = await openDb();
    if (!db) return;
    try {
      const rows = (await tx<Row[]>(db, "readonly", (s) => s.getAll())) ?? [];
      for (const row of rows) {
        if (!(row.blob instanceof Blob) || row.blob.size === 0) continue;
        entries.set(row.id, {
          url: URL.createObjectURL(row.blob),
          size: row.size,
          lastPlayed: row.lastPlayed,
          pinned: row.pinned === true,
          track: row.track ?? null,
        });
      }
    } catch {
      // An unreadable cache is an empty one.
    }
    changed();

    try {
      // Ask the browser not to clear this under storage pressure. It may say
      // no; the cache works either way, it just may be emptied sooner.
      await navigator.storage?.persist?.();
      const estimate = await navigator.storage?.estimate?.();
      if (estimate?.quota) {
        budgetBytes = Math.min(MAX_BUDGET_BYTES, Math.floor(estimate.quota * QUOTA_SHARE));
      }
    } catch {
      // Keep the fallback budget.
    }
  })();
  return ready;
}

/** An object URL for a saved song, or null. Synchronous on purpose (see top). */
export function cachedUrl(trackId: string): string | null {
  const meta = entries.get(trackId);
  if (!meta) return null;
  meta.lastPlayed = Date.now();
  void touch(trackId, meta.lastPlayed);
  return meta.url;
}

export function isCached(trackId: string): boolean {
  return entries.has(trackId);
}

async function touch(trackId: string, lastPlayed: number): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const row = await tx<Row>(db, "readonly", (s) => s.get(trackId));
    if (row) await tx(db, "readwrite", (s) => void s.put({ ...row, lastPlayed }));
  } catch {
    // Recency is a hint for eviction, not something worth failing over.
  }
}

/**
 * Downloads a song in full and keeps it. Deduplicated per track, and a no-op
 * for one already saved. Resolves either way; never throws.
 */
export function saveTrack(trackId: string, mimeType: string | null): Promise<void> {
  if (!enabled || entries.has(trackId)) return Promise.resolve();
  const pending = inflight.get(trackId);
  if (pending) return pending;

  const job = (async () => {
    const db = await openDb();
    if (!db) return;
    try {
      // The server answers with a redirect to the stream Worker, which sends
      // CORS headers, so a plain fetch follows it and can read the body.
      const res = await fetch(trackStreamUrl(trackId));
      if (!res.ok) return;
      const raw = await res.blob();
      if (raw.size === 0) return;
      const blob = mimeType && raw.type !== mimeType ? new Blob([raw], { type: mimeType }) : raw;

      if (!enabled) return;
      await makeRoom(db, blob.size);
      const row: Row = { id: trackId, blob, size: blob.size, lastPlayed: Date.now() };
      await tx(db, "readwrite", (s) => void s.put(row));
      entries.set(trackId, {
        url: URL.createObjectURL(blob),
        size: blob.size,
        lastPlayed: row.lastPlayed,
        pinned: false,
        track: null,
      });
      changed();
    } catch {
      // Offline, cut off, or out of room: the song simply streams next time.
    } finally {
      inflight.delete(trackId);
    }
  })();
  inflight.set(trackId, job);
  return job;
}

/** Drops the least recently played songs until `incoming` more bytes fit. */
async function makeRoom(db: IDBDatabase, incoming: number): Promise<void> {
  // A single file bigger than the whole budget would evict everything and
  // still not fit; that song just streams.
  if (incoming > budgetBytes) throw new Error("Too large to keep");
  let total = incoming;
  for (const meta of entries.values()) total += meta.size;

  // Downloads are never the ones to go; only songs saved in passing are.
  const oldestFirst = [...entries.entries()]
    .filter(([, meta]) => !meta.pinned)
    .sort((a, b) => a[1].lastPlayed - b[1].lastPlayed);
  while ((total > budgetBytes || entries.size + 1 > MAX_TRACKS) && oldestFirst.length > 0) {
    const [id, meta] = oldestFirst.shift()!;
    await tx(db, "readwrite", (s) => void s.delete(id));
    URL.revokeObjectURL(meta.url);
    entries.delete(id);
    total -= meta.size;
    changed();
  }
}

/**
 * Whether it is worth downloading ahead of what is playing. Not on a
 * connection the phone itself has flagged as metered or crawling.
 */
export function prefetchAllowed(): boolean {
  const connection = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  if (connection?.saveData) return false;
  if (connection?.effectiveType === "slow-2g" || connection?.effectiveType === "2g") return false;
  return true;
}

// --- Downloads (the installed web app) ---------------------------------------

export type DownloadState = "none" | "queued" | "downloading" | "saved";

const downloadState = new Map<string, "queued" | "downloading">();
const queue: Track[] = [];
let draining = false;
let lastError: string | null = null;

/** Why the last download failed, for the toast that reports it. */
export function takeDownloadError(): string | null {
  const error = lastError;
  lastError = null;
  return error;
}

function stateOf(trackId: string): DownloadState {
  const meta = entries.get(trackId);
  if (meta?.pinned) return "saved";
  return downloadState.get(trackId) ?? "none";
}

export function useDownloadState(trackId: string): DownloadState {
  return useSyncExternalStore(subscribe, () => stateOf(trackId));
}

/**
 * How much of a set of songs is downloaded, for a playlist or album header
 * and its tile in the library. Returned as a string so the snapshot is a
 * primitive that only changes when the numbers do.
 */
export function useDownloadSummary(trackIds: string[]): { saved: number; total: number; busy: boolean } {
  const key = useSyncExternalStore(subscribe, () => {
    let saved = 0;
    let busy = false;
    for (const id of trackIds) {
      const state = stateOf(id);
      if (state === "saved") saved++;
      else if (state !== "none") busy = true;
    }
    return `${saved}/${trackIds.length}/${busy ? 1 : 0}`;
  });
  const [saved, total, busy] = key.split("/");
  return { saved: Number(saved), total: Number(total), busy: busy === "1" };
}

/**
 * Queues songs to be downloaded and kept, one at a time so a playlist does not
 * open forty connections at once. Songs already downloaded or already queued
 * are skipped. Resolves when the queue has drained.
 */
export async function downloadTracks(tracks: Track[]): Promise<void> {
  await initAudioCache();
  for (const track of tracks) {
    if (!track.telegram_file_id || stateOf(track.id) !== "none") continue;
    downloadState.set(track.id, "queued");
    queue.push(track);
  }
  changed();
  await drain();
}

async function drain(): Promise<void> {
  if (draining) {
    // Another call is already working through the queue; wait for it.
    while (draining) await new Promise((r) => setTimeout(r, 250));
    return;
  }
  draining = true;
  try {
    while (queue.length > 0) {
      const track = queue.shift()!;
      if (!downloadState.has(track.id)) continue; // cleared meanwhile
      downloadState.set(track.id, "downloading");
      changed();
      try {
        await downloadOne(track);
      } catch (err) {
        lastError = err instanceof Error ? err.message : "Download failed";
      }
      downloadState.delete(track.id);
      changed();
    }
  } finally {
    draining = false;
  }
}

async function downloadOne(track: Track): Promise<void> {
  const db = await openDb();
  if (!db) throw new Error("This browser cannot keep downloads");

  const existing = entries.get(track.id);
  if (existing) {
    // Saved in passing already: keep the file, just stop it being evicted.
    const row = await tx<Row>(db, "readonly", (s) => s.get(track.id));
    if (row) {
      await tx(db, "readwrite", (s) => void s.put({ ...row, pinned: true, track }));
      existing.pinned = true;
      existing.track = track;
      return;
    }
  }

  const res = await fetch(trackStreamUrl(track.id));
  if (!res.ok) throw new Error("Could not download that song");
  const raw = await res.blob();
  if (raw.size === 0) throw new Error("Could not download that song");
  const blob = track.mime_type && raw.type !== track.mime_type ? new Blob([raw], { type: track.mime_type }) : raw;

  const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
  if (estimate?.quota && (estimate.usage ?? 0) + blob.size > estimate.quota * 0.9) {
    throw new Error("Not enough space on this device");
  }

  // Its cover too, so the song has its picture offline. The service worker
  // keeps whatever this fetches; where there is none, it simply is not kept.
  if (track.has_cover) void fetch(trackCoverUrl(track.id)).catch(() => undefined);

  const row: Row = { id: track.id, blob, size: blob.size, lastPlayed: Date.now(), pinned: true, track };
  await tx(db, "readwrite", (s) => void s.put(row));
  entries.set(track.id, {
    url: URL.createObjectURL(blob),
    size: blob.size,
    lastPlayed: row.lastPlayed,
    pinned: true,
    track,
  });
}

/** Deletes downloads. As with clearing, URLs stay valid for whatever is playing. */
export async function removeDownloads(trackIds: string[]): Promise<void> {
  const db = await openDb();
  for (const id of trackIds) {
    entries.delete(id);
    downloadState.delete(id);
  }
  changed();
  if (!db) return;
  try {
    await tx(db, "readwrite", (s) => {
      for (const id of trackIds) s.delete(id);
    });
  } catch {
    // Left for the next Delete all.
  }
}
