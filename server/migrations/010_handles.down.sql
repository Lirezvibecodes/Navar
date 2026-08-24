DROP INDEX IF EXISTS users_handle_lower_key;
ALTER TABLE users DROP COLUMN IF EXISTS handle;
