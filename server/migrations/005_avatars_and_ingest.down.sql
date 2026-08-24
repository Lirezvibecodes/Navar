DROP TABLE IF EXISTS ingest_sessions;
ALTER TABLE users DROP COLUMN IF EXISTS batch_hint_at;
ALTER TABLE users DROP COLUMN IF EXISTS avatar_file_id;
