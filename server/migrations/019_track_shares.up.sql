-- A track handed to somebody outside Navaar, by an opaque link rather than a
-- bare id — the same "the credential is the whole address" shape as
-- playlists.share_slug, so the public route can never be pointed at a track
-- it wasn't given.
--
-- One live token per (track, sender): re-sharing the same track reuses it
-- instead of minting a new one that would outlive the old link's purpose.
CREATE TABLE track_shares (
  token TEXT PRIMARY KEY,
  track_id UUID NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  sender_telegram_id BIGINT NOT NULL REFERENCES users(telegram_user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (track_id, sender_telegram_id)
);

CREATE INDEX track_shares_track_idx ON track_shares(track_id);
