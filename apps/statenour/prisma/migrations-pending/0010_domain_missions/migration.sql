-- 0010_domain_missions · 2026-06-09 · domain-anchored missions + classifier learning.
-- STATUS: apply to prod via POST /api/system/apply-pending-migration
--   { "name": "0010_domain_missions" } from an authed bdnick.info tab.
--   ADDITIVE · idempotent · ZERO data loss. No enum changes (deliberately
--   avoids ALTER TYPE — pgvector-safe). COLUMN-FIRST: apply with/before the deploy.
--
-- Adds:
--   · Mission.system_kind       — "GENERAL" marks a system-managed per-domain anchor
--   · Mission.canonical_domain  — one of the 6 life domains (health/mind/business/
--                                 social/spiritual/personal); the real routing key
--   · task_classification_corrections — append-only classifier learning signal
--
-- Rollback (trivial · no data depends on these): DROP the 2 columns + the table.

ALTER TABLE "Mission" ADD COLUMN IF NOT EXISTS "system_kind" VARCHAR(16);
ALTER TABLE "Mission" ADD COLUMN IF NOT EXISTS "canonical_domain" VARCHAR(24);

CREATE TABLE IF NOT EXISTS "task_classification_corrections" (
  "id" TEXT NOT NULL,
  "task_title" TEXT NOT NULL,
  "chosen_mission_id" TEXT,
  "domain" VARCHAR(24),
  "created_by" VARCHAR(64) DEFAULT 'user',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "task_classification_corrections_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "task_classification_corrections_created_at_idx"
  ON "task_classification_corrections" ("created_at" DESC);
