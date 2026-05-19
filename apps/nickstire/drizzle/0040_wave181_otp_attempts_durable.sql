-- wave-181.59: durable OTP brute-force counters.
--
-- Replaces an in-memory Map in server/middleware/bruteForce.ts. The map
-- worked under a single long-running Node process but failed in two
-- production-realistic scenarios:
--
--   1. PROCESS RESTART wiped the map. An attacker could keep brute-
--      forcing the verify endpoint after every Railway redeploy because
--      the failed-attempt counter reset to zero on cold start.
--
--   2. RAILWAY RUNS N INSTANCES of the API. Counts split across pods —
--      effective rate-limit was N× higher than intended (5 per pod, not
--      5 globally), so an attacker hitting different pods could send
--      5*N attempts before the threshold fired.
--
-- Counters now live in this table. The application uses atomic
-- INSERT ... ON DUPLICATE KEY UPDATE (same pattern as drizzle/
-- 0037_wave168_cron_locks.sql) so concurrent verifies from any pod
-- converge to a single row per phone, race-safe.
--
-- Semantics unchanged: 5 failed attempts inside a 15-minute window
-- triggers a 1-hour lockout. Only durability changed.
--
-- Indexes:
--   - PRIMARY (phone)              · the only hot lookup path
--   - idx_otp_attempts_blocked_until · for "currently-blocked" reports
--   - idx_otp_attempts_updated_at  · for cron cleanup scans

CREATE TABLE IF NOT EXISTS `otp_attempts` (
  `phone` varchar(30) NOT NULL,
  `attempt_count` int NOT NULL DEFAULT 0,
  `window_started_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `blocked_until` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`phone`),
  KEY `idx_otp_attempts_blocked_until` (`blocked_until`),
  KEY `idx_otp_attempts_updated_at` (`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
