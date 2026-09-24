-- Until someone picks their own tags, their profile wears the single most
-- valuable tag they have unlocked (tagEvaluator.ts's autoEquipBestTag), not
-- whatever happened to be equipped first. This flag is what tells the two
-- apart: it flips once, the first time setEquippedTags() runs for the user,
-- and from then on their equipped set is theirs and never touched again.
ALTER TABLE users ADD COLUMN tags_customized BOOLEAN NOT NULL DEFAULT false;

-- Anyone whose equipped set is anything other than the Newcomer tag alone
-- (026's default) already chose it themselves.
UPDATE users u SET tags_customized = true
WHERE EXISTS (
  SELECT 1 FROM user_equipped_tags e
  WHERE e.telegram_user_id = u.telegram_user_id AND e.tag_id <> 'newcomer'
);

-- Everyone else wears their best unlocked tag now, rather than on their next
-- unlock, in place of whatever they had equipped. Tier ranks mirror TAG_TIERS
-- in tags.ts (copper lowest); ties go to the most recently unlocked. Tags
-- missing from this list are copper.
DELETE FROM user_equipped_tags e
USING users u
WHERE u.telegram_user_id = e.telegram_user_id AND NOT u.tags_customized;

WITH tier(tag_id, rank) AS (
  VALUES
    ('deep_listener', 1), ('album_nerd', 1), ('art_director', 1),
    ('mixtape_machine', 1), ('track_pusher', 1), ('social_butterfly', 1),
    ('midnight_radio', 2), ('eclectic', 2), ('crate_goblin', 2),
    ('scene_builder', 2), ('metadata_police', 2), ('mixtape_dealer', 2),
    ('group_chat_dj', 2), ('connector', 2), ('taste_dealer', 2), ('rabbit_hole', 2),
    ('one_song_cult', 3), ('vault_keeper', 3), ('public_radio', 3),
    ('the_plug', 3), ('necromancer', 3),
    ('four_four_four', 4), ('obsessive', 4), ('archivist', 4)
),
best AS (
  SELECT DISTINCT ON (ut.telegram_user_id) ut.telegram_user_id, ut.tag_id
  FROM user_tags ut
  JOIN users u ON u.telegram_user_id = ut.telegram_user_id AND NOT u.tags_customized
  LEFT JOIN tier t ON t.tag_id = ut.tag_id
  ORDER BY ut.telegram_user_id, COALESCE(t.rank, 0) DESC, ut.unlocked_at DESC
)
INSERT INTO user_equipped_tags (telegram_user_id, tag_id, position)
SELECT telegram_user_id, tag_id, 0 FROM best;
