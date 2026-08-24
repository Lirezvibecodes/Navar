DROP TABLE IF EXISTS app_channels;
ALTER TABLE playlists DROP COLUMN IF EXISTS cover_file_id;
ALTER TABLE tracks    DROP COLUMN IF EXISTS cover_file_id;
