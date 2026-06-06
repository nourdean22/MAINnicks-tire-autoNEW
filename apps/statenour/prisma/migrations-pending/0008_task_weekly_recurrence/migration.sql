-- 0008_task_weekly_recurrence · 2026-06-06 · Custom weekday recurrence.
--
-- STATUS: apply to prod via POST /api/system/apply-pending-migration
--   { "name": "0008_task_weekly_recurrence" } from an authed bdnick.info tab
--   (the route's MIGRATIONS registry mirrors this SQL). Additive · idempotent
--   · zero data loss. COLUMN-FIRST: apply BEFORE the schema/code that reads
--   recurring_days goes live (full-row Task queries select the new column).
--
-- Lets a task recur on specific weekdays (e.g. "every Thursday"). Adds the
-- WEEKLY loop kind + a recurring_days int[] (0=Sun..6=Sat). On completion
-- checkTask snoozes a WEEKLY task to its next listed weekday; the existing
-- task-resurface cron resurfaces it (status WAITING -> READY) on that day.
--
-- Rollback (manual · the enum value cannot be dropped in PG, harmless to keep):
--   ALTER TABLE "Task" DROP COLUMN IF EXISTS "recurring_days";

ALTER TYPE "LoopKind" ADD VALUE IF NOT EXISTS 'WEEKLY';

ALTER TABLE "Task"
  ADD COLUMN IF NOT EXISTS "recurring_days" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
