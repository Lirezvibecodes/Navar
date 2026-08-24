-- A name of one's own.
--
-- Everything social in Navaar has so far leaned on users.username, which is
-- whatever Telegram handle that person happened to have the last time they
-- talked to the bot. It is optional, so most people simply have none; it is
-- changeable, so the one you noted down yesterday may belong to somebody else
-- tomorrow; and it is not resolvable through the Bot API, so it cannot be
-- searched for. As the thing people use to find each other, it is all three of
-- absent, unstable, and unsearchable.
--
-- A handle is chosen inside Navaar and belongs to Navaar: every account has
-- exactly one, and no two accounts share it. That is what makes "add @lirez"
-- a sentence the app can act on.
--
-- Nullable, because the column has to exist before anyone can fill it in and
-- because a row is created by the bot at ingest time, before its owner has
-- ever opened the app. The app asks for one on first launch.
ALTER TABLE users ADD COLUMN handle TEXT;

-- Unique case-insensitively, so @Lirez and @lirez cannot be two people, while
-- the column still stores the capitalisation its owner typed. An expression
-- index rather than a UNIQUE constraint for exactly that reason — and because
-- an index over an expression still admits any number of NULLs, which is what
-- every account that has not chosen yet holds.
CREATE UNIQUE INDEX IF NOT EXISTS users_handle_lower_key ON users (LOWER(handle));
