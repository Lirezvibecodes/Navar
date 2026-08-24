-- Telegram's own profile photo, cached as a file_id and refreshed
-- opportunistically on /start rather than looked up per request. Plenty of
-- people hide their photo; NULL here is the normal case, not a failure.
ALTER TABLE users ADD COLUMN avatar_file_id TEXT;

-- When the bot last offered to turn a burst of forwarded files into a
-- playlist. The offer is made at most once a day, so it needs somewhere to
-- remember that it was made.
ALTER TABLE users ADD COLUMN batch_hint_at TIMESTAMPTZ;

-- A batch-ingest session: the mode the user put the bot into, and the running
-- status message it edits in place as files arrive.
--
-- This lives in Postgres rather than in a Map because Render's free tier
-- sleeps the service after fifteen minutes idle, and a session that evaporates
-- mid-album is worse than no session at all. One active session per user, so
-- the user id is the primary key.
CREATE TABLE IF NOT EXISTS ingest_sessions (
  telegram_user_id BIGINT PRIMARY KEY REFERENCES users (telegram_user_id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('playlist', 'album')),
  -- Set for 'playlist' mode. An album does not get a playlist row: it is a tag
  -- written onto each track, and the Albums view derives itself from that.
  playlist_id UUID REFERENCES playlists (id) ON DELETE SET NULL,
  -- Resolved from the first file's tags, then applied to the rest of the batch.
  album_name TEXT,
  -- Where the running status message lives, so it can be edited rather than
  -- replaced. The mode confirmation becomes the status; there is never a
  -- second message.
  status_chat_id BIGINT,
  status_message_id INTEGER,
  added_count INTEGER NOT NULL DEFAULT 0,
  -- Names of the files that did not make it, so the closing summary can
  -- reconcile against what the user actually sent.
  failed_names TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Last time the status message was edited, to keep edits under Telegram's
  -- rate limit without a timer.
  status_edited_at TIMESTAMPTZ,
  -- Naming happens at the end, not the start: the user tapped [ Name it ] and
  -- the bot is waiting on a force-reply to this message. Matching the reply
  -- against a stored id keeps an unrelated message from being read as the
  -- answer.
  awaiting_name BOOLEAN NOT NULL DEFAULT false,
  name_prompt_message_id INTEGER
);

CREATE INDEX IF NOT EXISTS ingest_sessions_stale_idx ON ingest_sessions (updated_at);
