-- 20260722120000_experiment_factory · 2026-07-22 · closed-loop Experiment factory.
--
-- COLUMN-FIRST (read before applying): the two ALTER ... ADD COLUMN statements
-- add scalar columns to HOT tables (opportunity_logs, intelligence_sources) that
-- the regenerated Prisma client SELECTs on every read. Apply this migration to
-- prod BEFORE the schema-bearing code deploys — otherwise, between deploy and
-- apply, every prisma.opportunityLog.* / prisma.registeredSource.* query 500s
-- with "column does not exist". The old (pre-deploy) client ignores the new
-- columns, so applying early is harmless. (Same rule as 0008_task_weekly_recurrence.)
--
-- STATUS: apply via `railway run --service statenour-web -- node prisma/apply-experiment-factory.mjs`
--   (direct pg client, runs each statement whole so the DO $$ guards survive) OR,
--   once THIS code is deployed, POST /api/system/apply-pending-migration
--   { "name": "20260722120000_experiment_factory" } from an authed bdnick.info tab.
--   Do NOT use scripts/apply-pending-migration.ts — its naive split on ';' breaks DO $$.
--   Additive · idempotent (IF NOT EXISTS / guarded) · zero data loss — a new table +
--   nullable columns only; nothing existing is dropped or rewritten, so pgvector is untouched.
--
-- Rollback (manual):
--   DROP TABLE IF EXISTS "experiments";
--   ALTER TABLE "opportunity_logs"     DROP COLUMN IF EXISTS "source_id";
--   ALTER TABLE "intelligence_sources" DROP COLUMN IF EXISTS "auth_score_updated_at";
--   ALTER TABLE "intelligence_sources" DROP COLUMN IF EXISTS "auth_score_samples";

CREATE TABLE IF NOT EXISTS "experiments" (
  "id"              TEXT NOT NULL,
  "opportunity_id"  TEXT NOT NULL,
  "source_id"       TEXT,
  "hypothesis"      TEXT NOT NULL,
  "metric"          TEXT,
  "baseline"        DOUBLE PRECISION,
  "expected_effect" DOUBLE PRECISION,
  "status"          TEXT NOT NULL DEFAULT 'running',
  "actual_result"   TEXT,
  "started_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "due_at"          TIMESTAMP(3) NOT NULL,
  "measured_at"     TIMESTAMP(3),
  "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "experiments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "experiments_opportunity_id_key" ON "experiments" ("opportunity_id");
CREATE INDEX IF NOT EXISTS "experiments_status_due_at_idx" ON "experiments" ("status", "due_at");
CREATE INDEX IF NOT EXISTS "experiments_source_id_idx" ON "experiments" ("source_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experiments_opportunity_id_fkey') THEN
    ALTER TABLE "experiments" ADD CONSTRAINT "experiments_opportunity_id_fkey"
      FOREIGN KEY ("opportunity_id") REFERENCES "opportunity_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'experiments_source_id_fkey') THEN
    ALTER TABLE "experiments" ADD CONSTRAINT "experiments_source_id_fkey"
      FOREIGN KEY ("source_id") REFERENCES "intelligence_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "opportunity_logs" ADD COLUMN IF NOT EXISTS "source_id" TEXT;
CREATE INDEX IF NOT EXISTS "opportunity_logs_source_id_idx" ON "opportunity_logs" ("source_id");

ALTER TABLE "intelligence_sources" ADD COLUMN IF NOT EXISTS "auth_score_updated_at" TIMESTAMP(3);
ALTER TABLE "intelligence_sources" ADD COLUMN IF NOT EXISTS "auth_score_samples" INTEGER NOT NULL DEFAULT 0;
