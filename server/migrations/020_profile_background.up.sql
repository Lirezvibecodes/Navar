-- A profile's header defaults to a pixelated wash of the owner's most-played
-- track, computed on read. This column is the override, not the value —
-- null until somebody picks a cover from their own library, mirroring
-- playlists.cover_track_id: a track that is later deleted or loses its
-- artwork just falls back to the computed default, nothing to backfill.
ALTER TABLE users
  ADD COLUMN background_track_id UUID REFERENCES tracks (id) ON DELETE SET NULL;
