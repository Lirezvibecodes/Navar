-- Recreates endorsements exactly as 004_sharing.up.sql originally defined it.
CREATE TABLE IF NOT EXISTS endorsements (
  endorser_id BIGINT NOT NULL REFERENCES users (telegram_user_id) ON DELETE CASCADE,
  endorsee_id BIGINT NOT NULL REFERENCES users (telegram_user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (endorser_id, endorsee_id),
  CONSTRAINT endorsements_not_self CHECK (endorser_id <> endorsee_id)
);

CREATE INDEX IF NOT EXISTS endorsements_endorsee_idx ON endorsements (endorsee_id);
