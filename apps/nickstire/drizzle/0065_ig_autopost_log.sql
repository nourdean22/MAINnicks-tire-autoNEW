-- 2026-06-01 · drizzle/0065_ig_autopost_log.sql
--
-- Durable log for the autonomous Instagram + Facebook poster
-- (server/services/igAutopost.ts). One row per run (dryrun | posted |
-- failed | aborted). The Meta sibling of gbp_post_log (0xxx) — same idea,
-- richer columns because the IG brain is LLM-generated + eval-gated.
--
-- Access patterns this schema serves (why each index exists):
--   1. Anti-repetition guard — "the last ~30 conceptKeys" ordered by recency
--      → idx_ig_autopost_created (the generator is told NOT to repeat them).
--   2. Once-per-slot-per-day dedupe — "did the morning slot already run
--      today?" → idx_ig_autopost_slot_day (guards the 15-min cron cadence
--      from double-posting inside one slot window).
--   3. Admin review / health — filter by outcome → idx_ig_autopost_status.
--
-- HAND-APPLIED (per apps/nickstire/CLAUDE.md): there is no auto-migrate.
-- Apply this SQL to the DB, then run `pnpm run check`. Safe to re-run —
-- guarded by CREATE TABLE IF NOT EXISTS.
--
-- Rollback (if ever needed): DROP TABLE IF EXISTS `ig_autopost_log`;
-- (New, standalone table — nothing else depends on it.)

CREATE TABLE IF NOT EXISTS `ig_autopost_log` (
  `id`               INT AUTO_INCREMENT PRIMARY KEY,
  `archetype`        VARCHAR(20)   NOT NULL,
  `conceptKey`       VARCHAR(64)   NOT NULL,
  `slot`             VARCHAR(16)   NOT NULL DEFAULT 'manual',
  `slotDate`         VARCHAR(10)   NOT NULL,
  `evalScoresJson`   TEXT          NULL,
  `captionWeighted`  INT           NULL,
  `overallScore`     INT           NULL,
  `status`           VARCHAR(16)   NOT NULL,
  `caption`          TEXT          NOT NULL,
  `hashtags`         TEXT          NULL,
  `imagePrompt`      TEXT          NULL,
  `imageUrl`         VARCHAR(1000) NULL,
  `igPostId`         VARCHAR(64)   NULL,
  `fbPostId`         VARCHAR(64)   NULL,
  `error`            VARCHAR(500)  NULL,
  `source`           VARCHAR(16)   NOT NULL DEFAULT 'cron',
  `createdAt`        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_ig_autopost_created`  (`createdAt`),
  INDEX `idx_ig_autopost_slot_day` (`slot`, `slotDate`),
  INDEX `idx_ig_autopost_status`   (`status`)
);
