-- Apr 27 · GoalEvent — append-only log of goal progress + lifecycle.
-- Mirror of task_events table. Substrate for:
--   · sparkline + "loops this week" counter on goal cards (PLAN tab)
--   · Task→Goal completion lift (auto-bumping goal.currentValue when
--     a task with goalId completes)
--   · brain layer correlation between task velocity and goal pace
--
-- Idempotent: CREATE TABLE IF NOT EXISTS so this can be stamped against
-- environments that may have been hand-patched.

CREATE TABLE IF NOT EXISTS "goal_events" (
    "id"          TEXT NOT NULL,
    "goalId"      TEXT NOT NULL,
    "kind"        TEXT NOT NULL,
    "payload"     JSONB,
    "source"      TEXT,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goal_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "goal_events_goalId_created_at_idx"
  ON "goal_events" ("goalId", "created_at");

CREATE INDEX IF NOT EXISTS "goal_events_kind_created_at_idx"
  ON "goal_events" ("kind", "created_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'goal_events_goalId_fkey'
  ) THEN
    ALTER TABLE "goal_events"
      ADD CONSTRAINT "goal_events_goalId_fkey"
      FOREIGN KEY ("goalId") REFERENCES "life_goals"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
