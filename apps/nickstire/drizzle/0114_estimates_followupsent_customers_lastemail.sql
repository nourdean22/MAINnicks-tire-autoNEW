-- 0114: the column a cron job already reads but no migration ever created.
--
-- WHY (2026-09-01 admin audit, F-17): `emailCampaigns` reads and writes
-- `customers.lastEmailCampaignAt`; the column appears in no migration and not
-- in drizzle/schema.ts, so the job had been failing (now loudly, since the
-- receipts wave) since it was written.
--
-- CORRECTION #18 (2026-09-02, found while applying this file to production):
-- the first version of this file also added `estimates.followUpSent` for the
-- `estimate-followup` cron. Production has NO `estimates` table -- it never
-- existed in any migration or in drizzle/schema.ts; the only tables are
-- `alg_estimates` (the declined-work recovery pipeline, which already runs
-- 3d/7d/14d/30d/45d follow-ups with attempted/sent claims) and `estimates_log`.
-- So that cron had failed on every run since it was written, and its subject
-- was already covered. The job is retired in the same PR; the estimates half
-- of this file is gone. The filename is kept because the journal tag names it.
--
-- ADDITIVE and IDEMPOTENT: guarded by INFORMATION_SCHEMA so a re-run is a
-- no-op. The column is deliberately NOT added to drizzle/schema.ts -- a
-- projection-less `select().from(customers)` would otherwise name a column a
-- lagging environment may lack (nickstire-tidb-ddl skill). The job uses raw SQL.
--
-- Hand-applied (no auto-migrate). Verify first with:
--   SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
--   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'lastEmailCampaignAt';

SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'lastEmailCampaignAt'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE `customers` ADD COLUMN `lastEmailCampaignAt` TIMESTAMP NULL',
  'SELECT ''customers.lastEmailCampaignAt already present'' AS note');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
