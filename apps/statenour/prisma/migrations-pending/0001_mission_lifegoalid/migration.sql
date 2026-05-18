-- Phase A.3 schema migration · Mission.lifeGoalId
-- 2026-05-18 · per ADR-0012 · parked per operator's migration discipline
-- (ADR-0009: "No prod DB schema changes without a parked migration first").
--
-- Apply to Neon prod when operator confirms connectivity:
--   1. Verify schema.prisma matches this migration (no other drift)
--   2. Open Neon SQL editor (or psql via DATABASE_URL)
--   3. Run the statements below as a single transaction
--   4. Run `prisma generate` locally to refresh client types
--   5. Redeploy statenour-web on Railway
--
-- Rollback is trivial · DROP the column + DROP the index. No data loss
-- (column is nullable · no existing data depends on it · only NEW writes
-- after the deploy populate it).

BEGIN;

-- Add the FK column · nullable so existing missions don't break.
ALTER TABLE "Mission"
  ADD COLUMN "lifeGoalId" TEXT;

-- Add the FK constraint · ON DELETE SET NULL so deleting a goal
-- doesn't cascade-delete missions (operator may still want the mission
-- to exist as orphan · they can re-tag it).
ALTER TABLE "Mission"
  ADD CONSTRAINT "Mission_lifeGoalId_fkey"
  FOREIGN KEY ("lifeGoalId")
  REFERENCES "life_goals"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

-- Index for the common access pattern: "give me missions for goal X"
-- (sidebar of /goals page when LifeGoal.missions relation is included).
CREATE INDEX "Mission_lifeGoalId_idx" ON "Mission"("lifeGoalId");

COMMIT;
