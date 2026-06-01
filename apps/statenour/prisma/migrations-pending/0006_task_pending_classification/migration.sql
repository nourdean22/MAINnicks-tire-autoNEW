-- 0006_task_pending_classification · 2026-06-01 · Task confirm-chip wave.
-- STATUS: apply to prod via POST /api/system/apply-pending-migration
--   { "name": "0006_task_pending_classification" } from an authed bdnick.info
--   tab (the registry mirrors this SQL). Additive · idempotent · zero data loss.
--   Apply FIRST, then deploy the schema field (ambition-engine lesson).
--
-- pending_classification parks a LOW-confidence mission/goal proposal from
-- enrichTaskLinkage for operator approval (suggest-then-approve), instead of
-- silently dropping it. Mirrors PersonProfile.pending_classification.
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "pending_classification" JSONB;
