-- Whether the track's owner has set or cleared its lyrics by hand.
--
-- A lyrics miss is now retried once a day (see lyrics-provider.ts), which
-- makes "no lyrics" ambiguous: LRCLIB not having any, or the owner deleting
-- the ones it had because they were for the wrong song. Only the first is
-- worth asking again — retrying the second would put the wrong words back
-- every day. Existing rows start false; nothing recorded the difference before.
ALTER TABLE tracks ADD COLUMN lyrics_owner_edited boolean NOT NULL DEFAULT false;
