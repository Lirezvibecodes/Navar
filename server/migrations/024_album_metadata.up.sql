-- Album metadata is not user data — it is a fact about a real-world release
-- that MusicBrainz already knows, the same for every Navaar user who has that
-- album. Storing it once here, keyed by artist + album title rather than by
-- owner, means the first person to open "The Forever Story" pays for the
-- MusicBrainz lookup and everyone else who opens it afterwards gets the
-- cached answer for free.
--
-- Navaar has no album table and no external album identifier of its own —
-- albums are a GROUP BY over the free-text `album` tag on tracks (see
-- listAlbums in repo.ts) — so artist + title, lower-cased, is the strongest
-- key available. This mirrors tracks.lyrics_checked_at: a row is written
-- whether or not MusicBrainz found a match, so a title the fallback matching
-- can't place is asked about once rather than on every open. A later pass
-- could add a TTL and retry stale misses; this keeps that door open without
-- building it before it is needed.
CREATE TABLE album_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_name TEXT NOT NULL,
  album_title TEXT NOT NULL,
  -- NULL on all three of these together means "looked, MusicBrainz had
  -- nothing we could match" rather than "never checked" — fetched_at is set
  -- either way and is what distinguishes the two.
  musicbrainz_release_id TEXT,
  release_date TEXT,
  track_count INTEGER,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_album_metadata_lookup
  ON album_metadata (lower(artist_name), lower(album_title));
