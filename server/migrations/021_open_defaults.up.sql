-- 004_sharing made every default the closed one, on the theory that applying
-- it must not change anybody's exposure. The product's default has since
-- changed: a new playlist and a first play should now start open to friends,
-- not hidden from them.
--
-- These are column defaults only. Nobody's existing row is touched — a
-- playlist someone already set to 'private', or a listen_status row someone
-- already turned off, stays exactly as they left it. Only rows that do not
-- exist yet pick up the new default: a playlist created from here on, and the
-- first listen_status row a person ever gets (written the first time they
-- play something, before they have ever visited the privacy switch).
ALTER TABLE playlists ALTER COLUMN visibility SET DEFAULT 'friends';
ALTER TABLE listen_status ALTER COLUMN is_public SET DEFAULT true;
