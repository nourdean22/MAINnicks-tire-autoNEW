-- Rollback for 20260923150000_cron_job_log_skip_reason.
-- ORDER: revert the model field + writers FIRST (Prisma RETURNs every model
-- scalar, so dropping the column under a client that knows it fails every
-- cron_job_logs write), then run this, then delete the ledger row.
-- Loses only skip reasons; every other column is untouched.
ALTER TABLE "cron_job_logs" DROP COLUMN IF EXISTS "skipReason";
