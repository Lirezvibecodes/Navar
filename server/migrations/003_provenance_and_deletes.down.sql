DROP INDEX IF EXISTS tracks_owner_live_idx;
ALTER TABLE tracks DROP COLUMN IF EXISTS deleted_at;
ALTER TABLE tracks DROP COLUMN IF EXISTS origin_adder_id;
