-- Newcomer (tags.ts) is granted unconditionally at signup going forward
-- (repo.ts's ensureUser, on a genuinely new row), but that only covers users
-- created from here on. Backfill it for everyone who already existed, so no
-- profile is left showing an empty tag slot: unlock it for every user, then
-- equip it into position 0 only for those with nothing equipped at all —
-- anyone who already curated an equip set keeps it untouched.

INSERT INTO user_tags (telegram_user_id, tag_id)
SELECT telegram_user_id, 'newcomer' FROM users
ON CONFLICT DO NOTHING;

INSERT INTO user_equipped_tags (telegram_user_id, tag_id, position)
SELECT u.telegram_user_id, 'newcomer', 0
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM user_equipped_tags e WHERE e.telegram_user_id = u.telegram_user_id
)
ON CONFLICT DO NOTHING;
