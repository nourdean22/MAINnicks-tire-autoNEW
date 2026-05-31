-- Ambition Engine P1 · /stats goals redesign · ✅ APPLIED 2026-05-30 (additive · zero data loss)
--
-- STATUS: APPLIED to production Neon on 2026-05-30 via the guarded endpoint
--   POST /api/system/apply-pending-migration { name: "0003_ambition_engine" }
-- The dev/agent env has no prod creds, so the endpoint runs the idempotent
-- (IF NOT EXISTS) form of this SQL from inside the deployed app and records it
-- in _prisma_migrations as "0003_ambition_engine". The schema fields were then
-- restored + shipped in e285e9dc, so the live Prisma client matches the DB.
--
-- KEPT HERE (NOT moved into prisma/migrations/) on purpose: this folder name
-- sorts before the existing 2026* migrations but was applied AFTER them, so
-- moving it could trip `migrate deploy` ordering — and renaming it to a later
-- timestamp would break the name↔record match and re-run the non-idempotent
-- ADD COLUMNs below. `migrate deploy` only applies folders in prisma/migrations/,
-- so leaving it parked is drift-safe: the apply is already recorded.
--
-- DO NOT re-run this file directly (the ADD COLUMNs are NOT IF-NOT-EXISTS
-- guarded — that guarding lives in the endpoint's registry). For any FUTURE
-- migration, prefer the endpoint path (see ../README.md).

-- AlterTable · LifeGoal — 8 additive nullable/defaulted columns
ALTER TABLE "life_goals"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'metric',
  ADD COLUMN "parentGoalId" TEXT,
  ADD COLUMN "conviction" INTEGER,
  ADD COLUMN "ambition" TEXT,
  ADD COLUMN "lastChallengedAt" TIMESTAMP(3),
  ADD COLUMN "killCriteria" TEXT,
  ADD COLUMN "killBy" TIMESTAMP(3),
  ADD COLUMN "identityLine" TEXT;

-- Index + self-FK for the compounding ladder
CREATE INDEX "life_goals_parentGoalId_idx" ON "life_goals"("parentGoalId");
ALTER TABLE "life_goals"
  ADD CONSTRAINT "life_goals_parentGoalId_fkey"
  FOREIGN KEY ("parentGoalId") REFERENCES "life_goals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable · GoalStat (goal↔mastery-stat spine)
CREATE TABLE "goal_stats" (
  "id"         TEXT NOT NULL,
  "goalId"     TEXT NOT NULL,
  "statKey"    TEXT NOT NULL,
  "weight"     DOUBLE PRECISION NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "goal_stats_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "goal_stats_goalId_statKey_key" ON "goal_stats"("goalId", "statKey");
CREATE INDEX "goal_stats_statKey_idx" ON "goal_stats"("statKey");
ALTER TABLE "goal_stats"
  ADD CONSTRAINT "goal_stats_goalId_fkey"
  FOREIGN KEY ("goalId") REFERENCES "life_goals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
