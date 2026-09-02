-- 0114: the two columns cron jobs already read but no migration ever created.
--
-- WHY (2026-09-01 admin audit, F-17): `workOrderAutomation.processEstimateFollowUp`
-- selects and updates `estimates.followUpSent`, and `emailCampaigns` reads
-- `customers.lastEmailCampaignAt`. Neither column appears in any migration or
-- in drizzle/schema.ts. If they are absent in production the jobs have been
-- failing (now loudly, since the receipts wave) since they were written.
--
-- ADDITIVE and IDEMPOTENT: each ALTER is guarded by INFORMATION_SCHEMA so a
-- re-run is a no-op. Neither column is added to drizzle/schema.ts on purpose —
-- a projection-less `select().from(estimates)` would otherwise name a column
-- prod may still lack (nickstire-tidb-ddl skill). The jobs use raw SQL.
--
-- Hand-applied (no auto-migrate). Verify first with:
--   SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
--   WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'estimates' AND COLUMN_NAME = 'followUpSent';

SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'estimates' AND COLUMN_NAME = 'followUpSent'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE `estimates` ADD COLUMN `followUpSent` TINYINT NOT NULL DEFAULT 0',
  'SELECT ''estimates.followUpSent already present'' AS note');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'estimates' AND INDEX_NAME = 'idx_estimates_followup_created'
);
SET @ddl := IF(@idx_exists = 0,
  'ALTER TABLE `estimates` ADD INDEX `idx_estimates_followup_created` (`followUpSent`, `createdAt`)',
  'SELECT ''idx_estimates_followup_created already present'' AS note');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers' AND COLUMN_NAME = 'lastEmailCampaignAt'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE `customers` ADD COLUMN `lastEmailCampaignAt` TIMESTAMP NULL',
  'SELECT ''customers.lastEmailCampaignAt already present'' AS note');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
