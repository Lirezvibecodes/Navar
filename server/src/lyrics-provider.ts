/**
 * Looking a track's words up at LRCLIB.
 *
 * LRCLIB is a free, open, unauthenticated lyrics database. There is no key to
 * hold and no account to attach, which is the reason it was chosen: the only
 * thing that leaves this server is what a track calls itself.
 *
 * Everything here is treated as weather, the same rule audio-ingest.ts states
 * about Telegram. A lyrics lookup may never fail a request. The Lyrics pane is
 * a read path over a track that plays perfectly well without it, so nothing
 * here throws. But a timeout, a rate limit or a 500 is not an answer, and is
 * reported apart from "LRCLIB has never heard of this track": a miss is
 * recorded and asked again a day later, while a failure is not recorded at
 * all, so the next play simply asks again.
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

/**
 * How long a miss stands before LRCLIB is asked about that track again. Its
 * catalogue grows, so "no lyrics" is only true for now — but a lookup can
 * take seconds while the pane says it is loading, so replaying one song
 * without words should not pay that on every play.
 */
export const LYRICS_RETRY_MS = 24 * 60 * 60 * 1000;

/** LRCLIB could not be asked: a timeout, a network error, a 429 or a 5xx. */
class LookupFailed extends Error {}

/**
 * One GET, bounded. Resolves with the body, or null when LRCLIB answered that
 * it has nothing (a 404, or any other 4xx that asking again would not
 * change); throws LookupFailed when it could not answer at all.
 */
async function get(path: string): Promise<unknown> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: abort.signal,
    });
    if (res.status === 429 || res.status >= 500) throw new LookupFailed(`HTTP ${res.status}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    throw err instanceof LookupFailed ? err : new LookupFailed(String(err));
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
 * What asking LRCLIB came to. `answered: false` means it could not be asked,
 * which is not the same as "it has no words for this" and must not be
 * recorded as that.
 */
export type LyricsLookup = { answered: true; lyrics: string | null } | { answered: false };

/**
 * The words for a track.
 *
 * A track with no title is not looked up at all: the title is the only field
 * LRCLIB genuinely needs, and asking without one is a request that cannot
 * succeed — that is a miss, not a failure. Words from either endpoint win
 * even if the other one failed; only "nothing found, and something failed"
 * comes back unanswered.
 */
export async function lookupLyrics(query: LyricsQuery): Promise<LyricsLookup> {
  const title = query.title.trim();
  if (title === "") return { answered: true, lyrics: null };
  const normalised: LyricsQuery = { ...query, title };

  let failed = false;
  for (const attempt of [exact, search]) {
    try {
      const words = await attempt(normalised);
      if (words) return { answered: true, lyrics: words };
    } catch {
      failed = true;
    }
  }
  return failed ? { answered: false } : { answered: true, lyrics: null };
}

/**
 * Whether a track's stored lyrics state is worth a lookup now: no words, the
 * owner never set or cleared them by hand, and LRCLIB either was never asked
 * or last said no at least `LYRICS_RETRY_MS` ago.
 */
export function lyricsLookupDue(
  stored: { lyrics: string | null; lyrics_checked_at: Date | null; lyrics_owner_edited: boolean },
  now: number = Date.now()
): boolean {
  if (stored.lyrics !== null || stored.lyrics_owner_edited) return false;
  if (stored.lyrics_checked_at === null) return true;
  return now - stored.lyrics_checked_at.getTime() >= LYRICS_RETRY_MS;
}
