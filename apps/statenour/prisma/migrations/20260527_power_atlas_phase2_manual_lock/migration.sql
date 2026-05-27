-- 2026-05-27 · Power Atlas Phase 2 · manual-lock for powerBalance
-- Operator-mandated safety: when set to true, the Phase 3 auto-compute
-- engine MUST skip this profile (operator's slider value is sticky).
--
-- ADDITIVE · safe to re-run via IF NOT EXISTS guards · no data movement.
--
-- HOW TO APPLY
--   set -a && . ./.env.local && set +a
--   pnpm tsx scripts/apply-pending-migration.ts \
--     prisma/migrations/20260527_power_atlas_phase2_manual_lock/migration.sql
--   pnpm exec prisma migrate resolve --applied 20260527_power_atlas_phase2_manual_lock
--
-- ROLLBACK
--   ALTER TABLE person_profiles DROP COLUMN power_balance_manual_lock;

BEGIN;

ALTER TABLE person_profiles
  ADD COLUMN IF NOT EXISTS power_balance_manual_lock BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS person_profiles_power_balance_manual_lock_idx
  ON person_profiles (power_balance_manual_lock);

COMMIT;
