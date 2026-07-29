-- 0104 · Revenue Autopilot Wave 1 (2026-07-29)
-- Bounded retry + dead-letter truth for the outbound SMS queue.
--
-- send_attempts: definitive-failure count for a durable queued row. The drain
--   increments it per failed attempt and dead-letters the row at 5
--   (status='failed', failure_reason='max_retries_exceeded') instead of the
--   prior unbounded sending->queued->retry cycle that only the 48h time-bound
--   ever terminated (~190 doomed attempts per row).
-- failure_reason: WHY a row went terminal ('max_retries_exceeded',
--   'stale_sending_expired', gateway error slice) — previously a failed row
--   carried no cause anywhere.
--
-- Additive nullable only. Hand-apply via:
--   pnpm exec tsx scripts/migrations/apply-sms-send-attempts.ts
-- All reading/writing code degrades to pre-0104 behavior while these columns
-- are absent (unknown-column guarded — ROS-059 class).
ALTER TABLE sms_messages ADD COLUMN send_attempts INT NULL;
ALTER TABLE sms_messages ADD COLUMN failure_reason VARCHAR(255) NULL;
