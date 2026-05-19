-- wave-181.59 · At-most-once delivery for declined-work recovery SMS
--
-- The race fixed: cron iterates unmatched estimates, calls sendSms, then
-- updates `followUp{7,30}dSent=1`. If the process crashes (or Railway
-- restarts) between send and DB commit, the next run still sees Sent=0
-- and re-sends — customer gets the same recovery text twice. F25e
-- gateway returning "queued" early makes this worse: even a "successful"
-- send can lose the flag if the response handler crashes mid-await.
--
-- The fix: claim-then-send. Cron stamps `followUp{N}dAttemptedAt` inside
-- a conditional UPDATE (WHERE id=? AND AttemptedAt IS NULL) BEFORE
-- calling sendSms. affectedRows=0 means a peer process won the claim —
-- bail out cleanly. affectedRows=1 means we own this attempt; proceed
-- to send. Worst-case outcome flips from "duplicate send" to "missed
-- send", which the operator can recover from a manual review queue
-- (rows where SentAt IS NULL AND AttemptedAt IS NOT NULL).
--
-- Per-tier columns because the existing schema is two-tier (7d + 30d
-- each with own Sent + SentAt flags). A single shared AttemptedAt would
-- block legitimate 30d sends after a 7d send completed.
--
-- Columns are nullable + no default — existing rows keep AttemptedAt=NULL
-- so the next cron run can still attempt them normally. Zero-downtime.

ALTER TABLE `alg_estimates`
  ADD COLUMN `follow_up_7d_attempted_at` TIMESTAMP NULL AFTER `follow_up_7d_sent`,
  ADD COLUMN `follow_up_30d_attempted_at` TIMESTAMP NULL AFTER `follow_up_30d_sent`;
