-- A line or two about the playlist, written by whoever owns it.
--
-- Nullable rather than defaulted to the empty string: "this owner has never
-- written a description" and "this owner cleared the one they had" are the same
-- thing to every reader, and a null keeps the row honest about which of the two
-- it is without the app having to care.
--
-- The length cap is the one the app can actually show. A playlist header has
-- room for a short paragraph, and without a bound here a client bug could park
-- a megabyte of text in a column that every listing reads.
ALTER TABLE playlists
  ADD COLUMN description TEXT
  CONSTRAINT playlists_description_length CHECK (char_length(description) <= 500);
