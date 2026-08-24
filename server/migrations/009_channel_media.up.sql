-- Media moves out of Postgres and into two Telegram channels the bot admins.
--
-- Audio has always worked this way: a track row stores a file_id and the bytes
-- stay on Telegram's servers. Cover art was the exception, held inline as
-- BYTEA, which made the database grow in proportion to the library — the one
-- thing here that would exhaust a free 500MB tier. These columns hold the
-- file_id of a photo posted to the cover channel instead.
--
-- cover_image is deliberately left in place. It is the fallback for tracks not
-- yet offloaded, and the landing spot when the channel is unreachable, so a bad
-- day at Telegram costs a larger row rather than a lost cover.
ALTER TABLE tracks    ADD COLUMN cover_file_id TEXT;

-- A playlist can now carry a picture of its own rather than borrowing one from
-- a track inside it. Null keeps today's behaviour: resolve a cover on read.
ALTER TABLE playlists ADD COLUMN cover_file_id TEXT;

-- Where those channels are.
--
-- This is a table rather than an env var because the bot discovers the channels
-- itself, from the updates it receives once it has been made an admin: a
-- channel announces its own id and title, so asking a human to copy a -100…
-- number out of Telegram and into a dashboard is work that the bot can do for
-- itself and get right every time. The role is the key, so re-discovery after a
-- rename or a channel swap is an upsert rather than a duplicate.
CREATE TABLE app_channels (
  role       TEXT PRIMARY KEY,
  chat_id    BIGINT NOT NULL,
  title      TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
