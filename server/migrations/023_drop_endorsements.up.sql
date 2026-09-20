-- Drops the endorsements table.
--
-- It backed the Taste Tier ladder (server/src/badges.ts), a profile-header
-- chip that has been retired in favor of Navaar Tags as the app's one
-- collectible identity system. Taste Dealer (server/src/tags.ts) used to read
-- this table too — it has since been repointed at track_saves, so nothing in
-- the app queries endorsements once this migration lands.
DROP INDEX IF EXISTS endorsements_endorsee_idx;
DROP TABLE IF EXISTS endorsements;
