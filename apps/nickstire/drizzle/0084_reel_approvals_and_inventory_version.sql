-- 2026-07-16 · drizzle/0084_reel_approvals_and_inventory_version.sql
--
-- Reproducibility repair for the approval-integrity arc. Two objects were
-- declared in schema.ts but their DDL never reached prod as a journaled
-- migration, so a live audit found:
--   * social_content_approvals did NOT exist (every reel/V2 approve 500'd)
--   * social_content_inventory was MISSING the `version` column, so every
--     Drizzle query selecting it ("Unknown column 'version'") failed —
--     breaking non-reel publishPost and the WS3 provenance reads outright.
--
-- Both were hand-applied to prod on 2026-07-16 to stop the bleeding; this
-- migration makes them reproducible (fresh envs, dev DBs, rebuilds). All
-- statements are additive and idempotent (IF NOT EXISTS) so re-applying over
-- the hand-patched prod row is a no-op.

CREATE TABLE IF NOT EXISTS `social_content_approvals` (
  `id` varchar(64) NOT NULL,
  `inventory_id` varchar(64) NOT NULL,
  `version` int NOT NULL,
  `approved_by` int NOT NULL,
  `brief_hash` varchar(64) NOT NULL,
  `media_hash` varchar(64) NOT NULL,
  `media_url` text NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_sca_inventory_version` (`inventory_id`, `version`)
);
--> statement-breakpoint
ALTER TABLE `social_content_inventory` ADD COLUMN IF NOT EXISTS `version` int NOT NULL DEFAULT 1;
