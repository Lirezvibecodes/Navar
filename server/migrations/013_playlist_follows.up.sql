-- Saving somebody else's playlist to your own library, without copying it.
--
-- A follow is a reference by id, never a copy of the tracks: opening a
-- followed playlist always reads it through the same visibility-scoped route
-- every other viewer of that playlist uses, so it can never go stale the way
-- a snapshot would.
CREATE TABLE playlist_follows (
  follower_telegram_id BIGINT NOT NULL REFERENCES users(telegram_user_id) ON DELETE CASCADE,
  playlist_id UUID NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_telegram_id, playlist_id)
);

CREATE INDEX playlist_follows_playlist_idx ON playlist_follows(playlist_id);
