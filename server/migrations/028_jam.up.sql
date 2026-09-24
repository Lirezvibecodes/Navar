-- Jam Mode: listening along with a friend.
--
-- Nothing here runs on a timer, because nothing on this host can: the instance
-- sleeps after fifteen idle minutes. Every "expires", "goes stale" and "ends"
-- below is therefore a timestamp that the next read compares against now(),
-- and the partial indexes exist so those comparisons only ever touch the
-- handful of rows that are still open.

-- Where in the track a listener is, and whether it is moving. A profile draws
-- a live progress line from these three columns and the server's clock rather
-- than from a request per second. position_at is the server's receipt time,
-- never the client's, so a phone with a wrong clock cannot skew anyone else's
-- view of it.
ALTER TABLE listen_status
  ADD COLUMN position_seconds REAL,
  ADD COLUMN position_at TIMESTAMPTZ,
  ADD COLUMN is_playing BOOLEAN NOT NULL DEFAULT false;

-- One shared listening session. The host is authoritative: the playback
-- columns are only ever written by the host's own client, and host_seen_at is
-- what the lazy expiry reads to decide the host has gone.
CREATE TABLE IF NOT EXISTS jam_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_telegram_id BIGINT NOT NULL REFERENCES users (telegram_user_id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  current_track_id UUID REFERENCES tracks (id) ON DELETE SET NULL,
  -- The jam_queue row the host is playing, when it came from the shared queue.
  current_item_id UUID,
  position_seconds REAL NOT NULL DEFAULT 0,
  position_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_playing BOOLEAN NOT NULL DEFAULT false,
  host_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);

-- A host runs at most one jam at a time.
CREATE UNIQUE INDEX IF NOT EXISTS jam_sessions_one_active_per_host
  ON jam_sessions (host_telegram_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS jam_sessions_active_seen_idx
  ON jam_sessions (host_seen_at)
  WHERE status = 'active';

-- Who is in it. The host has a row too, so "everyone in this jam" and "is this
-- person in any jam" are one table each rather than a union.
CREATE TABLE IF NOT EXISTS jam_participants (
  jam_id UUID NOT NULL REFERENCES jam_sessions (id) ON DELETE CASCADE,
  telegram_user_id BIGINT NOT NULL REFERENCES users (telegram_user_id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('host', 'guest')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'left', 'removed')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (jam_id, telegram_user_id)
);

-- Nobody is in two jams at once, as host or guest.
CREATE UNIQUE INDEX IF NOT EXISTS jam_participants_one_active_per_user
  ON jam_participants (telegram_user_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS jam_participants_active_jam_idx
  ON jam_participants (jam_id)
  WHERE status = 'active';

-- Asking to join. Addressed to a host rather than to a jam, because the first
-- request is what creates the jam: until somebody is accepted there is nothing
-- to join, only a person listening.
CREATE TABLE IF NOT EXISTS jam_join_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_telegram_id BIGINT NOT NULL REFERENCES users (telegram_user_id) ON DELETE CASCADE,
  requester_telegram_id BIGINT NOT NULL REFERENCES users (telegram_user_id) ON DELETE CASCADE,
  jam_id UUID REFERENCES jam_sessions (id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  CONSTRAINT jam_join_requests_not_self CHECK (host_telegram_id <> requester_telegram_id)
);

-- One open request per person, to anyone. Waiting on two hosts at once would
-- mean being accepted into two jams.
CREATE UNIQUE INDEX IF NOT EXISTS jam_join_requests_one_pending
  ON jam_join_requests (requester_telegram_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS jam_join_requests_host_pending_idx
  ON jam_join_requests (host_telegram_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS jam_join_requests_requester_idx
  ON jam_join_requests (requester_telegram_id, created_at DESC);

-- The shared queue. Kept apart from anybody's personal queue — which never
-- leaves the client — so joining or hosting cannot touch it.
CREATE TABLE IF NOT EXISTS jam_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  jam_id UUID NOT NULL REFERENCES jam_sessions (id) ON DELETE CASCADE,
  track_id UUID NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  added_by BIGINT NOT NULL REFERENCES users (telegram_user_id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'played', 'removed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jam_queue_open_idx
  ON jam_queue (jam_id, position)
  WHERE status = 'queued';
