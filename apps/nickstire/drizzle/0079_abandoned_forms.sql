-- 2026-07-12 · drizzle/0079_abandoned_forms.sql
--
-- Durable partial-form store for the abandoned-form recovery-SMS pipeline
-- (server/services/abandonedForms.ts). Until now partials lived ONLY in an
-- in-memory Map, so a Railway restart dropped every partial captured in the
-- prior ~2h and their recovery SMS never fired. This table is the
-- survive-restart copy; the Map remains a synchronous write-through cache.
--
-- One row per browser session (sessionId PK), upserted on each blur beacon.
-- recoveryAttempted gates the one-shot recovery send. No backfill — the
-- table starts recording from the first blur after deploy.
--
-- ⚠️ OPERATOR-APPLIED (railway-run pattern, per nickstire migration rules).
--    NEVER auto-apply. The application code is deploy-safe WITHOUT this
--    table: abandonedForms.ts falls back to the in-memory Map (the exact
--    pre-persistence behavior) whenever the DB is unavailable OR this table
--    is missing, so shipping the code before running this migration is safe.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + a table-exists error are both
-- tolerated by scripts/db-migrate.ts on rerun.

CREATE TABLE IF NOT EXISTS `abandoned_forms` (
  `sessionId` VARCHAR(64) NOT NULL,
  `formType` VARCHAR(32) NOT NULL,
  `name` VARCHAR(200) NULL,
  `phone` VARCHAR(20) NULL,
  `email` VARCHAR(320) NULL,
  `service` VARCHAR(300) NULL,
  `pageUrl` VARCHAR(300) NULL,
  `recoveryAttempted` BOOLEAN NOT NULL DEFAULT FALSE,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`sessionId`),
  KEY `idx_abandoned_recovery` (`recoveryAttempted`, `createdAt`)
);
