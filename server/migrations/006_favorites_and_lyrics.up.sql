-- The heart on every track row. A timestamp rather than a boolean because
-- "recently favourited" is an ordering the library will want, and because a
-- NULL reads unambiguously as "never favourited" where a false does not say
-- whether it was ever set.
ALTER TABLE tracks ADD COLUMN favorited_at TIMESTAMPTZ;

-- Partial index: the favourites view only ever asks for the rows that have a
-- value, and on a library where most tracks are unfavourited that is a small
-- fraction of the table.
CREATE INDEX IF NOT EXISTS tracks_favorited_idx
  ON tracks (owner_telegram_id, favorited_at DESC)
  WHERE favorited_at IS NOT NULL;

-- Lyrics for the player's Lyrics pane, stored verbatim as the user supplied
-- them: an LRC file with [mm:ss.xx] stamps karaokes, anything else renders as
-- plain text, and NULL means the pane says there are none. Parsing happens in
-- the client, so a malformed stamp degrades to a plain line instead of
-- failing a write.
--
-- Deliberately not in TRACK_COLUMNS: a few kilobytes per track is nothing on
-- its own and megabytes across a library listing, so lyrics are fetched for
-- the one track the player is showing, the same way cover bytes are.
ALTER TABLE tracks ADD COLUMN lyrics TEXT;
