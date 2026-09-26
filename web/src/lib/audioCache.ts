import { trackStreamUrl } from "../api";

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
}

interface Meta {
  url: string;
  size: number;
  lastPlayed: number;
}

const entries = new Map<string, Meta>();
const inflight = new Map<string, Promise<void>>();
let dbPromise: Promise<IDBDatabase | null> | null = null;
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
        });
      }
    } catch {
      // An unreadable cache is an empty one.
    }

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
  if (entries.has(trackId)) return Promise.resolve();
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

      await makeRoom(db, blob.size);
      const row: Row = { id: trackId, blob, size: blob.size, lastPlayed: Date.now() };
      await tx(db, "readwrite", (s) => void s.put(row));
      entries.set(trackId, { url: URL.createObjectURL(blob), size: blob.size, lastPlayed: row.lastPlayed });
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

  const oldestFirst = [...entries.entries()].sort((a, b) => a[1].lastPlayed - b[1].lastPlayed);
  while ((total > budgetBytes || entries.size + 1 > MAX_TRACKS) && oldestFirst.length > 0) {
    const [id, meta] = oldestFirst.shift()!;
    await tx(db, "readwrite", (s) => void s.delete(id));
    URL.revokeObjectURL(meta.url);
    entries.delete(id);
    total -= meta.size;
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
