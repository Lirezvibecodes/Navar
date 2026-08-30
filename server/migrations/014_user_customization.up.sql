-- A user's own choices, layered on top of what Telegram supplies.
--
-- avatar_source tracks whether avatar_file_id is Telegram's profile photo
-- (refreshed automatically on every /start) or a picture the user uploaded
-- themselves — refreshAvatar must never overwrite the latter.
ALTER TABLE users ADD COLUMN avatar_source TEXT NOT NULL DEFAULT 'telegram';
ALTER TABLE users ADD COLUMN accent_color TEXT NOT NULL DEFAULT 'lime';
