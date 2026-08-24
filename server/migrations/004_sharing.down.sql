DROP TABLE IF EXISTS plays;
DROP TABLE IF EXISTS listen_status;
DROP TABLE IF EXISTS endorsements;
DROP TABLE IF EXISTS track_saves;
DROP TABLE IF EXISTS group_members;

ALTER TABLE playlist_tracks DROP COLUMN IF EXISTS added_by_telegram_id;

DROP INDEX IF EXISTS playlists_shared_idx;
DROP INDEX IF EXISTS playlists_group_chat_idx;
ALTER TABLE playlists
  DROP COLUMN IF EXISTS updated_at,
  DROP COLUMN IF EXISTS group_chat_id,
  DROP COLUMN IF EXISTS share_slug,
  DROP COLUMN IF EXISTS visibility;

DROP TABLE IF EXISTS friendships;
