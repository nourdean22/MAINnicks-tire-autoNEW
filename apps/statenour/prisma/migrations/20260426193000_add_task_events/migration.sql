-- Apr 26 · TaskEvent — append-only log of task state changes.
-- Substrate for upcoming NOW-mode upgrades:
--   · stale-flag analytics (skip patterns surface as avoidance signals)
--   · "0 today (3pm)" time-anchored stats
--   · "skipped 2× in 14d" line on Next Move card
--   · Bayesian priority calibration from completion outcomes
--
-- Idempotent: IF NOT EXISTS / IF NOT EXISTS so the migration can be
-- stamped against environments that may have been hand-patched.

CREATE TABLE IF NOT EXISTS "task_events" (
    "id"          TEXT NOT NULL,
    "taskId"      TEXT NOT NULL,
    "kind"        TEXT NOT NULL,
    "payload"     JSONB,
    "source"      TEXT,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "task_events_taskId_created_at_idx"
  ON "task_events" ("taskId", "created_at");

CREATE INDEX IF NOT EXISTS "task_events_kind_created_at_idx"
  ON "task_events" ("kind", "created_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'task_events_taskId_fkey'
  ) THEN
    ALTER TABLE "task_events"
      ADD CONSTRAINT "task_events_taskId_fkey"
      FOREIGN KEY ("taskId") REFERENCES "Task"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
