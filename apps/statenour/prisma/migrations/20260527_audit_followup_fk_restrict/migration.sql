-- 2026-05-27 · audit follow-up · enforce soft-delete at the FK level
--
-- Source: post-ghost-goal code-explorer audit, Finding #10.
-- AutomationPolicy is registered in SOFT_DELETE_MODELS (lib/db/
-- soft-delete.ts:54). The whole point is that policies live forever
-- and the audit trail (AutomationPolicyFire history) follows them so
-- the operator can answer "this policy used to fire · what did it
-- do?" months later. But the FK on automation_policy_fires.policy_id
-- was declared with ON DELETE CASCADE — meaning any stray caller that
-- bypasses softDelete() and uses `prisma.automationPolicy.delete()`
-- directly would silently destroy the entire fire history with no
-- audit log of the destruction.
--
-- This migration swaps CASCADE → RESTRICT so the FK now refuses
-- hard-deletes. Application-level code keeps using softDelete()
-- (which just sets deletedAt) so normal flow is unaffected; only
-- accidental or malicious hard-deletes hit the new wall.
--
-- ADDITIVE / SAFE: drops the old constraint and adds the new one with
-- the same name in a single transaction. No data is moved. Rollback
-- is symmetric (swap RESTRICT → CASCADE).
--
-- HOW TO APPLY
-- ─────────────────────────────────────────────────────────────────
--   set -a && . ./.env.local && set +a
--   pnpm tsx scripts/apply-pending-migration.ts \
--     prisma/migrations/20260527_audit_followup_fk_restrict/migration.sql
--   pnpm exec prisma migrate resolve \
--     --applied 20260527_audit_followup_fk_restrict
--   pnpm exec prisma migrate status   # should be clean
--
-- ROLLBACK
-- ─────────────────────────────────────────────────────────────────
--   ALTER TABLE automation_policy_fires
--     DROP CONSTRAINT automation_policy_fires_policy_id_fkey;
--   ALTER TABLE automation_policy_fires
--     ADD CONSTRAINT automation_policy_fires_policy_id_fkey
--     FOREIGN KEY (policy_id) REFERENCES automation_policies(id) ON DELETE CASCADE;

BEGIN;

ALTER TABLE automation_policy_fires
  DROP CONSTRAINT IF EXISTS automation_policy_fires_policy_id_fkey;

ALTER TABLE automation_policy_fires
  ADD CONSTRAINT automation_policy_fires_policy_id_fkey
  FOREIGN KEY (policy_id)
  REFERENCES automation_policies(id)
  ON DELETE RESTRICT;

COMMIT;
