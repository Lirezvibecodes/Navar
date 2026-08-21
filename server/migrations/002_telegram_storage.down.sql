ALTER TABLE tracks
  DROP COLUMN IF EXISTS telegram_file_id,
  DROP COLUMN IF EXISTS mime_type,
  DROP COLUMN IF EXISTS cover_image,
  DROP COLUMN IF EXISTS cover_mime_type,
  ADD COLUMN r2_audio_key TEXT NOT NULL,
  ADD COLUMN r2_cover_key TEXT;
