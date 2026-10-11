-- cron_job_logs . heal trigger id . 2026-10-11 (Codex P2 on #2984)
-- NOT APPLIED. Operator-run only (statenour-migration skill).
-- ADDITIVE . nullable . no default . no backfill . no data loss.
--
-- WHY: resolveTimedOutHeals (lib/services/autonomic-orchestrator.ts) settled a
-- timed-out heal from the job's next run row by name + time, so a later scheduled
-- success could verify a heal that never reached the route. A heal now sends
-- x-cron-trigger-id: heal:<attemptId>; cronHandler stamps it here and the resolver
-- matches on it. NULL = a scheduled run (or a row from before this column).
--
-- COLUMN NAME: snake_case "triggerId" via @map, unlike this table's camelCase
-- columns ("runId", "resultCount"). Raw SQL must quote "triggerId".
--
-- ORDER IS LOAD-BEARING: APPLY THIS BEFORE DEPLOYING THE MODEL CHANGE. Prisma
-- returns every scalar field on create/update, so a client that knows triggerId
-- against a table without it fails every cron_job_logs write repo-wide.
--
-- Separate statements, IF NOT EXISTS so a re-run is a no-op.

ALTER TABLE "cron_job_logs" ADD COLUMN IF NOT EXISTS "triggerId" VARCHAR(64);
CREATE INDEX IF NOT EXISTS "cron_job_logs_triggerId_idx" ON "cron_job_logs"("triggerId");
