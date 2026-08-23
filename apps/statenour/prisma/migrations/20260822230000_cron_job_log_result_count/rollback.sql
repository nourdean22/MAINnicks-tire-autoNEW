-- Rollback for 20260822230000_cron_job_log_result_count
-- Safe: the change is additive and nullable, so dropping it loses only the
-- counts recorded since it was applied. No other column or row is touched.
ALTER TABLE "cron_job_logs" DROP COLUMN IF EXISTS "resultCount";
