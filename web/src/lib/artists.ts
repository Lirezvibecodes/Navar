/**
 * The delimiters a multi-artist tag is written with: "Kid A, Thom Yorke",
 * "Kid A feat. Thom Yorke", "Kid A ft Thom Yorke", "Kid A with Thom Yorke". A
 * track tagged this way belongs on every one of those artists' pages, not on
 * a single combined artist named after the whole string.
 *
 * This mirrors splitArtists in server/src/repo.ts — the same duplication
 * LibraryContext.tsx already carries for the rest of its own-library grouping,
 * since the server endpoints are for browsing somebody else's library.
 */
const ARTIST_SPLIT = /\s*,\s*|\s+feat\.?\s+|\s+ft\.?\s+|\s+with\s+/gi;

export function splitArtists(raw: string): string[] {
  return raw
    .split(ARTIST_SPLIT)
    .map((name) => name.trim())
    .filter(Boolean);
}
