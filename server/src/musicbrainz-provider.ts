/**
 * Looking an album up at MusicBrainz.
 *
 * MusicBrainz is a free, open, unauthenticated release database. There is no
 * key to hold and no account to attach — the only thing that leaves this
 * server is the artist and album title Navaar already has.
 *
 * Everything here is treated as weather, the same rule lyrics-provider.ts
 * states about LRCLIB. An album metadata lookup may never fail a request. The
 * album header is a read path over an album that renders perfectly well
 * without it, so a timeout, a rate limit, a 500, a response in a shape we did
 * not expect — all of them come back as `null`, which the caller cannot tell
 * apart from "MusicBrainz has no matching release", and does not need to.
 *
 * One attempt, five seconds, no retries. This runs inside a request that
 * somebody is waiting on, on an instance that may itself have just woken up;
 * a second attempt would double the wait to improve an outcome that is
 * optional either way.
 */

/** MusicBrainz asks that clients identify themselves and link to their source. */
const USER_AGENT =
  "Navaar/1.0 (Telegram Mini App music player; https://github.com/navaar)";

const BASE = "https://musicbrainz.org/ws/2";

const TIMEOUT_MS = 5000;

/**
 * What MusicBrainz's release search returns. Every field is optional here
 * even where their API documents it as present: this is parsed from a third
 * party's JSON, so the types describe what we are willing to rely on, not
 * what we were promised.
 */
interface MusicBrainzRelease {
  id?: string;
  score?: number;
  date?: string;
  "track-count"?: number;
}

interface MusicBrainzSearchResponse {
  releases?: MusicBrainzRelease[];
}

export interface AlbumMetadata {
  musicbrainzReleaseId: string;
  releaseDate: string | null;
  trackCount: number | null;
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
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Lucene, MusicBrainz's query syntax, treats `"` and `\` as syntax. */
function escapeLucene(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

/**
 * The best release for an artist + album title.
 *
 * MusicBrainz's own Lucene-style search scores every candidate 0-100 against
 * exactly the two fields asked for (title, artist). A release-group can hold
 * a dozen regional or format pressings of the same album, so among whichever
 * ones tie for the top score, the earliest release date is taken as the
 * closest thing to "the original edition" available without an identifier of
 * our own to disambiguate deluxe/regional/reissue variants.
 */
async function bestRelease(artist: string, album: string): Promise<MusicBrainzRelease | null> {
  const query = `release:"${escapeLucene(album)}" AND artist:"${escapeLucene(artist)}"`;
  const params = new URLSearchParams({ query, fmt: "json", limit: "10" });
  const body = (await get(`/release/?${params.toString()}`)) as MusicBrainzSearchResponse | null;
  const releases = body?.releases;
  if (!releases || releases.length === 0) return null;

  const topScore = Math.max(...releases.map((r) => r.score ?? 0));
  const topRated = releases.filter((r) => (r.score ?? 0) === topScore);
  topRated.sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));
  return topRated[0];
}

/**
 * An album's release date and total track count, or null.
 *
 * Callers must treat null as "asked and found nothing usable", not as "did
 * not ask" — the difference is recorded in the database, not here.
 */
export async function lookupAlbum(artist: string, album: string): Promise<AlbumMetadata | null> {
  const release = await bestRelease(artist.trim(), album.trim());
  if (!release?.id) return null;
  return {
    musicbrainzReleaseId: release.id,
    releaseDate: release.date ?? null,
    trackCount: release["track-count"] ?? null,
  };
}
