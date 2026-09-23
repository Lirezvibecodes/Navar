-- The release's own track order and titles from MusicBrainz, alongside the
-- release date and track count migration 024 already caches. Fetched in the
-- same lookup, keyed by the same artist_name/album_title pair, and subject to
-- the same rule: NULL means either "never looked" or "MusicBrainz had no
-- usable tracklist for this release", distinguished only by fetched_at, same
-- as the three columns already on this table.
ALTER TABLE album_metadata ADD COLUMN tracklist JSONB;
