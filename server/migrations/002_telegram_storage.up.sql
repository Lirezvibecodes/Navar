-- Audio now stays on Telegram's servers permanently; the server only stores
-- a file_id to re-fetch it through the Bot API, plus cover art as bytes
-- directly in Postgres (small enough for the free tier, no object storage).
ALTER TABLE tracks
  DROP COLUMN IF EXISTS r2_audio_key,
  DROP COLUMN IF EXISTS r2_cover_key,
  ADD COLUMN telegram_file_id TEXT NOT NULL,
  ADD COLUMN mime_type TEXT,
  ADD COLUMN cover_image BYTEA,
  ADD COLUMN cover_mime_type TEXT;
