-- Null until the user has actually chosen — seeded from Telegram's reported
-- language_code on first contact, then confirmed or overridden via the
-- bot's language picker. Never guessed beyond that seed.
ALTER TABLE users ADD COLUMN language TEXT;
