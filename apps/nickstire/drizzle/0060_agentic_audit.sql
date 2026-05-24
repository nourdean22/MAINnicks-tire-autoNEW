-- wave-181.x · Tier S · agentic-actions-auditor
--
-- Pairs with the call-eval cron (migration 0057). The eval cron grades
-- the conversation outcome (0-100 score). The auditor grades the AGENT'S
-- DECISIONS during the call · tool calls fired, args passed, downstream
-- effects. Findings live under metadata.agenticAudit JSON path.
--
-- Why JSON over a new findings table · audit findings are per-call · a
-- single call has 0-N findings. JSON keeps the 1:1 with vapi_call_logs
-- intact · simpler joins · still queryable via JSON_EXTRACT.

ALTER TABLE vapi_call_logs ADD COLUMN IF NOT EXISTS metadata JSON DEFAULT NULL;
ALTER TABLE vapi_call_logs ADD COLUMN IF NOT EXISTS audited_at TIMESTAMP NULL DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_vapi_audited_at ON vapi_call_logs (audited_at);
