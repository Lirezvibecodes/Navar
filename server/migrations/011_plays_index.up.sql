-- The plays prune runs on every insert, because a free instance that sleeps
-- has nowhere to run a scheduled job. Without an index on played_at that
-- prune is a sequential scan of the whole table on every play; with one it is
-- an index probe that, almost every time, finds nothing to delete at all.
--
-- The existing plays_user_recent_idx cannot serve it: it leads with
-- telegram_user_id, and the prune is deliberately not scoped to one person —
-- an account that stops opening the app would otherwise keep its rows forever.
CREATE INDEX IF NOT EXISTS plays_played_at_idx ON plays (played_at);
