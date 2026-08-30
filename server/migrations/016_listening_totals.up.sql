-- plays is retention-pruned (see recordPlay), so it can't answer "lifetime
-- hours listened" on its own. This is a running total, incremented once per
-- play at record time, before pruning ever gets a chance to drop the row.
ALTER TABLE users ADD COLUMN total_listened_seconds BIGINT NOT NULL DEFAULT 0;
