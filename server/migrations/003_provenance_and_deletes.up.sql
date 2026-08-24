-- Who first brought a track into Navaar, as distinct from who owns this row.
-- When B saves A's track, B owns the copy but A remains the origin, and when C
-- later saves B's copy the credit still reads A: the save path inherits this
-- column rather than recomputing it from the source's owner.
ALTER TABLE tracks
  ADD COLUMN origin_adder_id BIGINT REFERENCES users (telegram_user_id) ON DELETE SET NULL;

-- Everything that exists today was added by the person who owns it.
UPDATE tracks SET origin_adder_id = owner_telegram_id WHERE origin_adder_id IS NULL;

-- Deletion is soft, so the undo snackbar has a row to restore and so a
-- playlist that still references the track does not break underneath it.
-- Rows past the undo window are swept lazily on ingest; nothing here runs on a
-- timer, because the free tier has no scheduler.
ALTER TABLE tracks ADD COLUMN deleted_at TIMESTAMPTZ;

-- Every read path filters deleted_at IS NULL, so the live set is the one worth
-- indexing.
CREATE INDEX IF NOT EXISTS tracks_owner_live_idx
  ON tracks (owner_telegram_id, created_at DESC)
  WHERE deleted_at IS NULL;
