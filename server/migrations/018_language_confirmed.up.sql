-- `language` is seeded automatically from Telegram's language_code (see
-- ensureUser), so by the time /start's picker gate runs the column is never
-- null — which would otherwise make "has this person actually chosen?"
-- unanswerable. This flag carries that distinct fact: false until
-- setUserLanguage is called from an explicit tap, true from then on.
ALTER TABLE users ADD COLUMN language_confirmed BOOLEAN NOT NULL DEFAULT false;
