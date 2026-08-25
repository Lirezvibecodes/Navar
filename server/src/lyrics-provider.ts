/**
 * Looking a track's words up at LRCLIB.
 *
 * LRCLIB is a free, open, unauthenticated lyrics database. There is no key to
 * hold and no account to attach, which is the reason it was chosen: the only
 * thing that leaves this server is what a track calls itself.
 *
 * Everything here is treated as weather, the same rule audio-ingest.ts states
 * about Telegram. A lyrics lookup may never fail a request. The Lyrics pane is
 * a read path over a track that plays perfectly well without it, so a timeout,
 * a rate limit, a 500, a response in a shape we did not expect — all of them
 * come back as `null`, which the caller cannot tell apart from "LRCLIB has
 * never heard of this track", and does not need to.
 *
 * One attempt, four seconds, no retries. This runs inside a request that
 * somebody is waiting on, on an instance that may itself have just woken up;
 * a second attempt would double the wait to improve an outcome that is
 * optional either way.
 */

/** LRCLIB asks that clients identify themselves and link to their source. */
const USER_AGENT =
  "Navaar/1.0 (Telegram Mini App music player; https://github.com/navaar)";

const BASE = "https://lrclib.net/api";

const TIMEOUT_MS = 4000;

/**
 * What LRCLIB returns. Every field is optional here even where their API
 * documents it as present: this is parsed from a third party's JSON, so the
 * types describe what we are willing to rely on, not what we were promised.
 */
interface LrclibRecord {
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  instrumental?: boolean;
}

export interface LyricsQuery {
  title: string;
  artist: string | null;
  album: string | null;
  durationSeconds: number | null;
}

/** One GET, bounded, with anything unexpected flattened to null. */
async function get(path: string): Promise<unknown> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: abort.signal,
    });
    // A 404 is LRCLIB saying it has no such track, which is an answer rather
    // than a failure — but it is the same `null` to everyone above this.
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The words out of one record.
 *
 * Synced is preferred because web/src/lib/lyrics.ts already karaokes an LRC
 * file and falls back to plain rendering on its own, so taking the timed
 * version can only ever be better. An instrumental is a real answer — the
 * track has no words — and is reported as a miss, since a pane saying "no
 * lyrics found" is the correct thing to show for one.
 */
function wordsOf(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as LrclibRecord;
  if (record.instrumental === true) return null;
  for (const candidate of [record.syncedLyrics, record.plainLyrics]) {
    if (typeof candidate === "string" && candidate.trim() !== "") {
      return candidate;
    }
  }
  return null;
}

/**
 * The exact-match endpoint, which is the one that can answer with a duration
 * and so the one that will not hand back a live version of the wrong length.
 */
async function exact(query: LyricsQuery): Promise<string | null> {
  const params = new URLSearchParams({
    track_name: query.title,
    artist_name: query.artist ?? "",
  });
  if (query.album) params.set("album_name", query.album);
  if (query.durationSeconds != null && query.durationSeconds > 0) {
    params.set("duration", String(Math.round(query.durationSeconds)));
  }
  return wordsOf(await get(`/get?${params.toString()}`));
}

/**
 * The search endpoint, for when the exact match found nothing.
 *
 * Telegram's tags are whatever the uploader typed, so an album that reads
 * "Album (Deluxe)" or a duration off by a second is enough to miss an exact
 * lookup on a track LRCLIB plainly has. Search drops the album and the
 * duration and takes the first result that carries any words at all.
 */
async function search(query: LyricsQuery): Promise<string | null> {
  const params = new URLSearchParams({ track_name: query.title });
  if (query.artist) params.set("artist_name", query.artist);

  const body = await get(`/search?${params.toString()}`);
  if (!Array.isArray(body)) return null;
  for (const row of body.slice(0, 5)) {
    const words = wordsOf(row);
    if (words) return words;
  }
  return null;
}

/**
 * The words for a track, or null.
 *
 * A track with no title is not looked up at all: the title is the only field
 * LRCLIB genuinely needs, and asking without one is a request that cannot
 * succeed. Callers must treat null as "asked and did not find", not as "did
 * not ask" — the difference is recorded in the database, not here.
 */
export async function lookupLyrics(query: LyricsQuery): Promise<string | null> {
  const title = query.title.trim();
  if (title === "") return null;
  const normalised: LyricsQuery = { ...query, title };
  return (await exact(normalised)) ?? (await search(normalised));
}
