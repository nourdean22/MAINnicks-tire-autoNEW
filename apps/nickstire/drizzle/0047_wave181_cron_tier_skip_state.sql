-- wave-181.83 · durable scheduler tier-skip state.
--
-- Replaces the in-memory `tierSkipCounts = new Map<string, number>()` at
-- server/cron/scheduler.ts:68. Pre-fix · pod restart during a chronic
-- overrun cleared the counter · so the alert that should fire on the
-- 2nd consecutive skip never fired (counter reset to 1 on restart).
-- Same class as wave-181.59 OTP brute-force + wave-181.68 SMS rate-limit
-- durability fixes.
--
-- Schema · one row per tier. consecutive_skips increments on each skip
-- and resets to 0 on a successful run. last_skip_at + last_run_at give
-- the operator visibility into oscillation patterns.
--
-- Indexes · PK on tier_name is sufficient (every read/write is by tier).
-- No cleanup needed · row count is bounded by the number of tiers (~6).
--
-- Multi-pod note · each pod runs its own scheduler instance. The DB-
-- backed counter is GLOBAL across pods · so a chronic overrun on
-- ANY pod increments the counter that EVERY pod reads. That's what
-- we want for cross-pod alerting · before the wave-181.69 cron_alerts_
-- fired dedup ensures Telegram fires once per day total.

CREATE TABLE IF NOT EXISTS `cron_tier_skip_state` (
  `tier_name` VARCHAR(50) NOT NULL,
  `consecutive_skips` INT NOT NULL DEFAULT 0,
  `last_skip_at` TIMESTAMP NULL,
  `last_run_at` TIMESTAMP NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`tier_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
