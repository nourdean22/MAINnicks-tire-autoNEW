-- 0096: link scheduled_posts back to social_content_inventory.
--
-- scheduled_posts previously carried NO reference to the inventory row that
-- scheduled it. Consequences (verified 2026-07-24):
--   * instagramStudio.reject flipped the inventory row to "rejected" but could
--     not cancel the pending scheduled_posts row — the cron still published
--     content the operator explicitly rejected.
--   * runScheduledPosts could not write the fire-time outcome back, so the
--     inventory row said "scheduled" forever regardless of posted/failed.
--
-- Additive + nullable: legacy rows keep NULL and are unaffected.
-- Hand-applied (no auto-migrate), same as 0071_scheduled_posts.sql.

-- TiDB accepts only ONE schema change per ALTER (the combined form throws
-- ER_KEY_COLUMN_DOES_NOT_EXITS) — keep these as two statements.
ALTER TABLE scheduled_posts ADD COLUMN inventoryId VARCHAR(64) NULL;
ALTER TABLE scheduled_posts ADD INDEX idx_scheduled_inventory (inventoryId);
