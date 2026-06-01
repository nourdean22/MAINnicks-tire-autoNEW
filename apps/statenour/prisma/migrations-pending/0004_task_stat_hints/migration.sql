-- 0004_task_stat_hints · 2026-06-01 · Task classification + scoring wave.
-- STATUS: PENDING — apply to prod via POST /api/system/apply-pending-migration
--   { "name": "0004_task_stat_hints" } from an authed bdnick.info tab
--   (the registry mirrors this SQL). Additive + idempotent + zero data loss.
--   Apply FIRST, then deploy the schema field (the ambition-engine lesson:
--   deploying the client before the column = "column does not exist").
--
-- statHints = the classifier-assigned mastery stat keys a task feeds, so a
-- goal-less task still credits a real character-sheet stat on completion.
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "statHints" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
