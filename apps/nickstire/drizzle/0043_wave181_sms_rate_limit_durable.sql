-- wave-181.66: durable SMS daily rate-limit counter.
--
-- Sister bug to wave-181.59 (otp_attempts). Replaces an in-memory Map
-- in server/sms.ts (smsCountMap) that had the same two production-
-- realistic durability holes:
--
--   1. PROCESS RESTART wiped the counter. Railway redeploys reset every
--      customer's daily count to 0 — a customer who already received 8
--      messages today could immediately receive 8 more after a deploy.
--
--   2. RAILWAY RUNS N INSERTS of the API. Counters split across pods —
--      with MAX_SMS_PER_PHONE_PER_DAY=8 and 2 pods, a single customer
--      could receive up to 8 × N sends per 24h before the cap fired.
--
-- Not a security bug (TCPA daily cap is courtesy, not legal) but the
-- same brittleness class as OTP — and the operator gets real complaints
-- about message-bombing after deploys. Counter now lives in this table.
-- The application uses atomic INSERT ... ON DUPLICATE KEY UPDATE (same
-- pattern as drizzle/0040_wave181_otp_attempts_durable.sql) so concurrent
-- sends from any pod converge to a single row per phone, race-safe.
--
-- Semantics unchanged: MAX_SMS_PER_PHONE_PER_DAY sends per rolling 24h
-- window. Only durability changed. The short-term cooldown (5-min between
-- sends) stays in-memory in sms.ts — its window is tight enough that
-- restart loss isn't meaningful, and avoiding a DB roundtrip on the
-- cooldown check keeps the hot path lean.
--
-- Indexes:
--   - PRIMARY (phone)             · the only hot lookup path
--   - idx_sms_rate_limit_updated_at · for cron cleanup scans

CREATE TABLE IF NOT EXISTS `sms_rate_limit` (
  `phone` varchar(30) NOT NULL,
  `count_24h` int NOT NULL DEFAULT 0,
  `window_started_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_sent_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`phone`),
  KEY `idx_sms_rate_limit_updated_at` (`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
