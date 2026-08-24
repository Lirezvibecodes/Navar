-- A playlist's cover is normally the first track in it that carries artwork,
-- computed on read. That is the right default and stays right as the playlist
-- changes, but it gives the owner no say: reordering is the only way to change
-- the picture, which is a strange thing to have to know.
--
-- This column is the override, not the value. It is null on every playlist
-- until somebody picks a cover, and reads fall back to the computed one, so
-- nothing has to be backfilled and a playlist whose chosen track is later
-- deleted quietly goes back to choosing for itself.
ALTER TABLE playlists
  ADD COLUMN cover_track_id UUID REFERENCES tracks (id) ON DELETE SET NULL;
