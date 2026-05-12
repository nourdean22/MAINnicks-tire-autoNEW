-- wave-168: cron_locks table for race-safe cron orchestration across dyno
-- restart. The in-memory job.running flag in server/cron/index.ts protected
-- against overlap within a single Node process but did nothing when Railway
-- restarted the dyno mid-cron — duplicate SMS sends to real customers in
-- the worst case.
--
-- Acquire pattern uses INSERT ... ON DUPLICATE KEY UPDATE with token check.
-- See drizzle/schema.ts cronLocks table comment for full protocol.

CREATE TABLE IF NOT EXISTS `cron_locks` (
  `name` varchar(100) NOT NULL,
  `lock_token` varchar(36) NOT NULL,
  `holder` varchar(100) NOT NULL,
  `locked_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `locked_until` timestamp NOT NULL,
  PRIMARY KEY (`name`),
  KEY `idx_cron_locks_until` (`locked_until`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
