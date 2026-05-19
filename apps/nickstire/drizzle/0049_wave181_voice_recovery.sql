-- wave-181.85 · voice recovery escalation columns on alg_estimates.
--
-- Pattern · after 2 SMS follow-ups (D7 + D30 · waves 181.59/82) the
-- customer is "warm cold" · they engaged in some way but didn't book.
-- Voice call is the escalation channel for that specific cohort: estimates
-- where followUp30dSent=1 AND matched_invoice_id IS NULL AND 7+ days since
-- the D30 send · meaning the SMS thread didn't convert.
--
-- The cron fires through AgentPhone hosted-mode with a brand-voice prompt
-- that re-offers the Repair Haiku in spoken form. ~$0.10/call × ~20-50
-- calls/month = $2-5/month. Expected lift · 5-15% additional recovery
-- on the declined pipeline that SMS alone couldn't close.
--
-- Columns are nullable · no default · existing rows keep NULL so the
-- cron starts fresh. At-most-once via the same conditional UPDATE
-- pattern as wave-181.59 (follow_up_30d_attempted_at).

ALTER TABLE `alg_estimates`
  ADD COLUMN `voice_recovery_attempted_at` TIMESTAMP NULL AFTER `follow_up_30d_attempted_at`,
  ADD COLUMN `voice_recovery_call_id` VARCHAR(64) NULL AFTER `voice_recovery_attempted_at`,
  ADD COLUMN `voice_recovery_outcome` ENUM('pending','dialing','interested','not_interested','no_answer','failed') NULL AFTER `voice_recovery_call_id`;
