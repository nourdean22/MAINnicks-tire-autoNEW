-- Rollback for 20260917234500_cron_job_log_run_id
-- Safe: the change is additive and nullable, so dropping it loses only the run
-- ids recorded since it was applied. No other column or row is touched, and the
-- settle path in lib/inngest/cron-lifecycle.ts falls back to matching the
-- newest `started` row for the job — degraded, documented, not broken.
--
-- Drop the index first: dropping the column would take it with it, but being
-- explicit keeps a partial re-run of this file idempotent.
DROP INDEX IF EXISTS "cron_job_logs_runId_started_idx";
ALTER TABLE "cron_job_logs" DROP COLUMN IF EXISTS "runId";
