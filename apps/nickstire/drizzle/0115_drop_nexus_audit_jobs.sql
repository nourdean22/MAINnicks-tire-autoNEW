-- 0115: retire the Nexus SMS-audit queue nothing drains.
--
-- OPERATOR-GATED · DESTRUCTIVE. Do not run from an agent session. Read
-- apps/nickstire/docs/ADMIN-LOOPS-ARCHAEOLOGY-BOUNDARY-2026-09-01.md §1.3 first.
--
-- WHY: `nexus_audit_jobs` was created by 0076 (2026-07-09, "SignalForge Nexus
-- Production Wiring") together with a consumer, nexusAuditor.ts, that was never
-- scheduled and was deleted in #1329 (2026-08-04) as "built, tested and never
-- wired". The producer in smsOrchestrator kept inserting a row per sampled
-- text into a queue with no reader. The producer, the sampler and the Drizzle
-- definition are removed by the same PR as this file, so after that deploy no
-- code references the table.
--
-- BEFORE dropping, keep the house backup (two statements — TiDB rejects
-- CREATE TABLE ... AS SELECT):
--   CREATE TABLE `_bak_nexus_audit_jobs_drop_20260901` LIKE `nexus_audit_jobs`;
--   INSERT INTO `_bak_nexus_audit_jobs_drop_20260901` SELECT * FROM `nexus_audit_jobs`;
--   SELECT COUNT(*) FROM `_bak_nexus_audit_jobs_drop_20260901`;  -- must equal the source count
--
-- Then, and only then. The defect ledger carried a FK to this table (0076);
-- MySQL refuses to drop a referenced parent, so the constraint goes first
-- (guarded — a re-run is a no-op). The `auditJobId` column itself stays,
-- nullable and unreferenced, matching drizzle/schema.ts.
SET @fk_exists := (
  SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'nickgpt_defect_ledger'
    AND CONSTRAINT_NAME = 'nickgpt_defect_ledger_auditJobId_nexus_audit_jobs_id_fk'
);
SET @ddl := IF(@fk_exists > 0,
  'ALTER TABLE `nickgpt_defect_ledger` DROP FOREIGN KEY `nickgpt_defect_ledger_auditJobId_nexus_audit_jobs_id_fk`',
  'SELECT ''FK already absent'' AS note');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

DROP TABLE IF EXISTS `nexus_audit_jobs`;
