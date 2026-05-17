-- Apr 18 quality sweep: targeted indexes surfaced by load paths.
-- BrainMemory.lastSeen — decay() scans for stale-30d rows hourly.
-- CronJobLog composite — watcher looks up (jobName, status, recent).
-- Idempotent: CREATE INDEX IF NOT EXISTS so re-runs are safe and
-- the migration can be stamped against the existing Neon DB
-- without blocking on the longer-standing drift.

CREATE INDEX IF NOT EXISTS "brain_memories_last_seen_idx"
  ON "brain_memories" ("last_seen");

CREATE INDEX IF NOT EXISTS "cron_job_logs_jobName_status_createdAt_idx"
  ON "cron_job_logs" ("jobName", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "cron_job_logs_createdAt_idx"
  ON "cron_job_logs" ("createdAt");
