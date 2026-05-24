-- 2026-05-23 · drizzle/0057_vapi_call_eval.sql
--
-- Adds eval columns to vapi_call_logs so the daily Nick AI eval cron
-- can score every call (0-100), classify outcome, and persist reasoning
-- for compound improvement.
--
-- Why columns on vapi_call_logs (not a new vapi_call_evals table):
--   - Lowest friction · existing row already holds summary, transcript URL,
--     phone, duration, endedReason · adding 4 fields beats a JOIN
--   - Eval is computed once per call (we don't re-eval), so versioning
--     isn't required
--   - Drift-proof against the existing admin /voice-receptionist surface
--
-- Score formula (computed by cron, ranged 0-100):
--   +30 if structuredData.outcome IN ('booked', 'callback_scheduled')
--   +20 if successEvaluation === 'pass'
--   +15 if sentiment === 'positive' (-15 if 'negative')
--   +15 if 30s < duration < 360s (productive call duration)
--   +10 if tool_called state reached (engaged with tools)
--   +10 / -25 LLM critique adjustment (catches kill-list / praises good)
--   Cap 0-100. Sub-50 = wasted; 50-69 = info_only; 70-84 = converted; 85+ = exemplary

ALTER TABLE vapi_call_logs ADD COLUMN eval_score TINYINT NULL DEFAULT NULL;
ALTER TABLE vapi_call_logs ADD COLUMN eval_outcome VARCHAR(32) DEFAULT NULL;
ALTER TABLE vapi_call_logs ADD COLUMN eval_reasoning TEXT DEFAULT NULL;
ALTER TABLE vapi_call_logs ADD COLUMN eval_at TIMESTAMP NULL DEFAULT NULL;
CREATE INDEX idx_vapi_eval_at_score ON vapi_call_logs (eval_at, eval_score);
