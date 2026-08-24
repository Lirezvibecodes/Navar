-- Everything sharing-related lands in one migration, and every default in it
-- is the closed one: applying this must not change a single person's exposure.

-- A friendship is one row, not two. The requester/addressee split only records
-- who asked; once status is 'accepted' the relationship is symmetric, which is
-- why every visibility check has to look in both directions.
CREATE TABLE IF NOT EXISTS friendships (
  requester_id BIGINT NOT NULL REFERENCES users (telegram_user_id) ON DELETE CASCADE,
  addressee_id BIGINT NOT NULL REFERENCES users (telegram_user_id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (requester_id, addressee_id),
  CONSTRAINT friendships_not_self CHECK (requester_id <> addressee_id)
);

CREATE INDEX IF NOT EXISTS friendships_addressee_idx
  ON friendships (addressee_id, status);

-- Playlists gain a visibility level, a link credential, and an optional
-- Telegram group they belong to.
--
-- share_slug is the credential for an unauthenticated link, so it is only ever
-- populated while visibility permits it, and rotating it is the only way to
-- revoke a link that has already been passed around.
ALTER TABLE playlists
  ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'friends', 'public')),
  ADD COLUMN share_slug TEXT UNIQUE,
  ADD COLUMN group_chat_id BIGINT,
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Unique, not merely indexed: a Telegram group has exactly one shared crate,
-- and the bot has to be able to say "create it if it is not already there"
-- from two different updates (being added to the chat, and the first audio
-- posted in it) without ever producing a second one.
CREATE UNIQUE INDEX IF NOT EXISTS playlists_group_chat_idx
  ON playlists (group_chat_id)
  WHERE group_chat_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS playlists_shared_idx
  ON playlists (visibility)
  WHERE visibility <> 'private';

-- In a group playlist the person who contributed a track is not the person who
-- owns the playlist, so the contribution has to be recorded on the edge.
ALTER TABLE playlist_tracks
  ADD COLUMN added_by_telegram_id BIGINT REFERENCES users (telegram_user_id) ON DELETE SET NULL;

-- Populated opportunistically from whatever the bot happens to see in a group.
-- There is deliberately no backfill and no attempt to enumerate a membership
-- list: this answers "has this person been seen in this chat", nothing more.
CREATE TABLE IF NOT EXISTS group_members (
  group_chat_id BIGINT NOT NULL,
  telegram_user_id BIGINT NOT NULL REFERENCES users (telegram_user_id) ON DELETE CASCADE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_chat_id, telegram_user_id)
);

-- Saving somebody else's track copies the row. This records the provenance of
-- that copy: who saved it, who they got it from, and which row it produced.
CREATE TABLE IF NOT EXISTS track_saves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  saver_id BIGINT NOT NULL REFERENCES users (telegram_user_id) ON DELETE CASCADE,
  origin_id BIGINT NOT NULL REFERENCES users (telegram_user_id) ON DELETE CASCADE,
  source_track_id UUID REFERENCES tracks (id) ON DELETE SET NULL,
  saved_track_id UUID NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT track_saves_once UNIQUE (saver_id, source_track_id)
);

CREATE INDEX IF NOT EXISTS track_saves_saved_track_idx ON track_saves (saved_track_id);
CREATE INDEX IF NOT EXISTS track_saves_origin_idx ON track_saves (origin_id);
CREATE INDEX IF NOT EXISTS track_saves_saver_recent_idx ON track_saves (saver_id, created_at DESC);

-- Endorsements are earned, not given freely: the route may only insert here
-- when the endorser has actually saved something from the endorsee, and that
-- rule is enforced by the insert query itself.
CREATE TABLE IF NOT EXISTS endorsements (
  endorser_id BIGINT NOT NULL REFERENCES users (telegram_user_id) ON DELETE CASCADE,
  endorsee_id BIGINT NOT NULL REFERENCES users (telegram_user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (endorser_id, endorsee_id),
  CONSTRAINT endorsements_not_self CHECK (endorser_id <> endorsee_id)
);

CREATE INDEX IF NOT EXISTS endorsements_endorsee_idx ON endorsements (endorsee_id);

-- What somebody is listening to right now. is_public defaults false, so
-- nobody starts out broadcasting; a row with is_public false is invisible to
-- everyone, and the feed returns nothing at all for that person rather than a
-- placeholder saying they are hidden.
CREATE TABLE IF NOT EXISTS listen_status (
  telegram_user_id BIGINT PRIMARY KEY REFERENCES users (telegram_user_id) ON DELETE CASCADE,
  track_id UUID REFERENCES tracks (id) ON DELETE SET NULL,
  is_public BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS listen_status_live_idx
  ON listen_status (updated_at DESC)
  WHERE is_public;

-- The one table here that grows without bound, so the write path prunes it.
CREATE TABLE IF NOT EXISTS plays (
  id BIGSERIAL PRIMARY KEY,
  telegram_user_id BIGINT NOT NULL REFERENCES users (telegram_user_id) ON DELETE CASCADE,
  track_id UUID NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  played_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS plays_user_recent_idx ON plays (telegram_user_id, played_at DESC);
