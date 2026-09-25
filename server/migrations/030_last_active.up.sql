-- When this person last had the app open. Stamped at sign-in and on a slow
-- heartbeat while the Mini App is on screen, and read only as "recently or
-- not" — it is what puts the online dot on a friend's profile, which used to
-- appear only once they pressed play. Nullable, no backfill: somebody who has
-- not opened the app since this column existed is simply not online.
ALTER TABLE users ADD COLUMN last_active_at timestamptz;
