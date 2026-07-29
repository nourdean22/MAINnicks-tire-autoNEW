-- 0105 · Revenue Autopilot Wave 2 (2026-07-29)
-- sent_at: when the gateway ACCEPTED an outbound sms_messages row. The ops
-- surface deliberately refused to report queue->sent latency without this
-- column (a createdAt proxy would fabricate the metric); this makes the
-- creation->dispatch latency honestly measurable. Stamped best-effort by the
-- send paths; NULL rows simply don't enter the metric.
--
-- Additive nullable only. Hand-apply via:
--   pnpm exec tsx scripts/migrations/apply-sms-sent-at.ts
ALTER TABLE sms_messages ADD COLUMN sent_at TIMESTAMP NULL;
