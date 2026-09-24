DROP TABLE IF EXISTS jam_queue;
DROP TABLE IF EXISTS jam_join_requests;
DROP TABLE IF EXISTS jam_participants;
DROP TABLE IF EXISTS jam_sessions;

ALTER TABLE listen_status
  DROP COLUMN IF EXISTS position_seconds,
  DROP COLUMN IF EXISTS position_at,
  DROP COLUMN IF EXISTS is_playing;
