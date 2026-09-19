-- Navaar Tags: a collectible identity layer that sits beside the endorsement
-- Taste Tier ladder (badges.ts), never inside it. A tag is unlocked once and
-- keeps a durable record of that moment; it is never re-evaluated away.
--
-- `plays` is retention-pruned (see recordPlay in repo.ts), so none of the
-- lifetime/per-track counts a tag condition needs can be summed from it after
-- the fact. These tables are the durable aggregates that survive the prune,
-- written at the same moments plays/tracks/playlists/friendships already are.

-- One row per user, for the handful of counters that have no other durable
-- home. Deliberately narrow: a column is added here only when a specific tag
-- condition needs it, never as a generic bucket for "stats we might want".
CREATE TABLE IF NOT EXISTS user_tag_stats (
  telegram_user_id BIGINT PRIMARY KEY REFERENCES users (telegram_user_id) ON DELETE CASCADE,
  -- Qualified plays whose local time fell in 00:00-05:00, for Midnight Radio.
  -- Only ever incremented when the client reports its own local time; a play
  -- with no local-time signal is simply not counted toward this, rather than
  -- guessed at from server time.
  midnight_plays BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lifetime, per-track play counts, immune to the 90-day prune that plays
-- itself is subject to. Backs Repeat Offender / One Song Cult / Obsessive, and
-- last_played_at backs Necromancer (a track played again after a 90+ day gap).
CREATE TABLE IF NOT EXISTS user_tag_track_stats (
  telegram_user_id BIGINT NOT NULL REFERENCES users (telegram_user_id) ON DELETE CASCADE,
  track_id UUID NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  play_count BIGINT NOT NULL DEFAULT 0,
  first_played_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_played_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (telegram_user_id, track_id)
);

-- Distinct calendar days with a qualified play, for Regular. A day is the
-- client-reported local date when the client supplies one, and the server's
-- own UTC date otherwise; either way the row is written once per day no
-- matter how many plays land on it, via ON CONFLICT DO NOTHING.
CREATE TABLE IF NOT EXISTS user_tag_listening_days (
  telegram_user_id BIGINT NOT NULL REFERENCES users (telegram_user_id) ON DELETE CASCADE,
  day DATE NOT NULL,
  PRIMARY KEY (telegram_user_id, day)
);

-- Distinct normalized artists (trimmed, case-folded, split the same way
-- splitArtists() in repo.ts splits a multi-artist tag) ever qualified-listened
-- to, for Eclectic. Kept separate from ownership-based artist counts (Scene
-- Builder, Archivist), which are computed live off owned tracks instead.
CREATE TABLE IF NOT EXISTS user_tag_listened_artists (
  telegram_user_id BIGINT NOT NULL REFERENCES users (telegram_user_id) ON DELETE CASCADE,
  artist_key TEXT NOT NULL,
  PRIMARY KEY (telegram_user_id, artist_key)
);

-- The unlock ledger. Written once per tag per user with the same
-- INSERT ... SELECT ... WHERE EXISTS (eligibility) ON CONFLICT DO NOTHING
-- idiom endorsePerson() already uses, so a condition re-checked from several
-- call sites at once can never double-unlock or race. tag_id has no foreign
-- key of its own — the catalogue lives in code (tags.ts), the same way a
-- badge tier id does in badges.ts.
CREATE TABLE IF NOT EXISTS user_tags (
  telegram_user_id BIGINT NOT NULL REFERENCES users (telegram_user_id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL,
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (telegram_user_id, tag_id)
);

-- Up to three unlocked tags pinned to a profile. position (0-2) is the
-- display slot rather than a count, which is what lets a replace be a single
-- upsert instead of a delete-then-reinsert; the at-most-three rule itself is
-- enforced in the repo function, since it is a count constraint a CHECK can't
-- express. UNIQUE(telegram_user_id, tag_id) stops the same tag from taking
-- two slots at once.
CREATE TABLE IF NOT EXISTS user_equipped_tags (
  telegram_user_id BIGINT NOT NULL REFERENCES users (telegram_user_id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL,
  position SMALLINT NOT NULL CHECK (position BETWEEN 0 AND 2),
  PRIMARY KEY (telegram_user_id, position),
  UNIQUE (telegram_user_id, tag_id)
);
