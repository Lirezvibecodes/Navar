-- Support for the large-batch status line: the most recently added track's
-- label (survives the debounced/trailing edit, which re-reads the session
-- from the database rather than from the call that triggered it), and a
-- running tally of artist counts for the closing "by artist" summary.
ALTER TABLE ingest_sessions ADD COLUMN last_track_label TEXT;
ALTER TABLE ingest_sessions ADD COLUMN artist_tally JSONB NOT NULL DEFAULT '{}'::jsonb;
