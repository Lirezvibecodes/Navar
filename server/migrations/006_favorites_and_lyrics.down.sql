DROP INDEX IF EXISTS tracks_favorited_idx;
ALTER TABLE tracks DROP COLUMN IF EXISTS lyrics;
ALTER TABLE tracks DROP COLUMN IF EXISTS favorited_at;
