-- The client already computes and sends local-time signals on every play
-- (localDate, localMinuteOfDay — see recordPlay), but until now they were
-- only forwarded into tag-evaluation and never kept on the row itself. The
-- listening-stats time-of-day and day-of-week views need exactly this: the
-- user's own local time, not the server's. Nullable, no backfill — a play
-- recorded before this column existed just sits out of those two views,
-- which is an acceptable empty-state case for old history.
ALTER TABLE plays
  ADD COLUMN local_date date,
  ADD COLUMN local_minute_of_day smallint;
