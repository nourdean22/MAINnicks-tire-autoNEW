-- Ambition Engine P1 · /stats goals redesign · PARKED (additive · zero data loss)
--
-- WHY PARKED: committed schema fields without prod DB access deploy a Prisma
-- client that SELECTs columns the live Neon DB lacks → "column does not exist"
-- on every LifeGoal CRUD (the exact incident in ../README.md). So the schema
-- fields were reverted; this SQL waits here until applied WITH prod creds.
--
-- TO APPLY (see ../README.md): confirm DATABASE_URL is prod (not localhost) →
--   mv prisma/migrations-pending/0003_ambition_engine prisma/migrations/<ts>_ambition_engine
--   pnpm release:db   (= prisma migrate deploy)
-- THEN restore the schema fields (the LifeGoal columns + GoalStat model + the
-- parent/children + statLinks relations + parentGoalId index — see
-- docs/specs/2026-05-30-ambition-engine.md) and commit.

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
