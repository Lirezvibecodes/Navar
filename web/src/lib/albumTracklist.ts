import type { AlbumCopy, AlbumTracklistEntry } from "../api";
import type { Track } from "../types";
import { trackTitle } from "./format";

/**
 * A title reduced to the part that should match across sources: MusicBrainz
 * spells a featured or joint artist into the track title itself ("Off Deep
 * End (feat. Kenny Mason)", "Off Deep End (with Kenny Mason)"), which a
 * locally-tagged file frequently drops, capitalizes differently, or
 * punctuates differently. Matching only needs "is this the same song," so
 * everything past that is discarded rather than reconciled.
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[([][^)\]]*\b(feat\.?|ft\.?|featuring|with)\b[^)\]]*[)\]]/gi, " ")
    .replace(/\b(feat\.?|ft\.?|featuring)\b.*$/i, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface AlbumTracklistMatch {
  /** One row per MusicBrainz track, in release order. `track` is set when owned. */
  matched: { position: number; title: string; track: Track | null }[];
  /** Owned tracks in release order, followed by any that matched nothing. */
  ordered: Track[];
}

/**
 * Lines up a locally-tagged album against the release's own tracklist.
 *
 * Each MusicBrainz entry claims at most one local track with a matching
 * normalized title, so two songs that happen to share a title don't both
 * collapse onto the first release entry. Anything left unclaimed — a bonus
 * track, a title that didn't normalize the same way — still belongs in the
 * album, so `ordered` appends it rather than dropping it.
 */
export function matchAlbumTracklist(
  tracks: Track[],
  tracklist: AlbumTracklistEntry[]
): AlbumTracklistMatch {
  const byTitle = new Map<string, Track[]>();
  for (const track of tracks) {
    const key = normalizeTitle(trackTitle(track));
    const bucket = byTitle.get(key);
    if (bucket) bucket.push(track);
    else byTitle.set(key, [track]);
  }

  const usedIds = new Set<string>();
  const matched = tracklist.map((entry) => {
    const bucket = byTitle.get(normalizeTitle(entry.title));
    const track = bucket && bucket.length > 0 ? bucket.shift()! : null;
    if (track) usedIds.add(track.id);
    return { position: entry.position, title: entry.title, track };
  });

  const leftovers = tracks.filter((t) => !usedIds.has(t.id));
  const ordered = [
    ...matched.flatMap((m) => (m.track ? [m.track] : [])),
    ...leftovers,
  ];

  return { matched, ordered };
}

/**
 * For each release entry still missing from the Crate, the copy somebody else
 * could lend it (see AlbumCopy), keyed by position. `copies` arrives oldest
 * first, so taking the first title match is what makes the first uploader the
 * one credited when several people have the same song.
 */
export function matchAlbumCopies(
  matched: AlbumTracklistMatch["matched"],
  copies: AlbumCopy[]
): Map<number, AlbumCopy> {
  const byTitle = new Map<string, AlbumCopy>();
  for (const copy of copies) {
    const key = normalizeTitle(trackTitle(copy));
    if (!byTitle.has(key)) byTitle.set(key, copy);
  }

  const found = new Map<number, AlbumCopy>();
  for (const entry of matched) {
    if (entry.track) continue;
    const copy = byTitle.get(normalizeTitle(entry.title));
    if (copy) found.set(entry.position, copy);
  }
  return found;
}
