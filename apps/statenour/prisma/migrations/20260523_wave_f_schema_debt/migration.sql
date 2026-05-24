-- 2026-05-23 · Wave F · Tier-2 schema debt
--
-- Source: /infinite-gratitude 10-agent audit · database-architect lens.
-- Three changes · all ADDITIVE · no destructive moves · safe to re-run
-- (every statement uses IF NOT EXISTS · CONCURRENTLY for indexes).
--
-- 1. contradictions  · add updated_at + deleted_at + 2 indexes
-- 2. task_events     · add goal_id + (goal_id, created_at) index
-- 3. voice_latency_events · add (assistant_id, stage, created_at) index
--
-- HOW TO APPLY
-- ─────────────────────────────────────────────────────────────────
--   set -a && . ./.env.local && set +a
--   pnpm tsx scripts/apply-pending-migration.ts \
--     prisma/migrations-pending/20260523_wave_f_schema_debt/migration.sql
--   pnpm exec prisma migrate resolve \
--     --applied 20260523_wave_f_schema_debt
--   pnpm exec prisma migrate status   # should be clean
--
-- ROLLBACK
-- ─────────────────────────────────────────────────────────────────
-- The DROP COLUMN paths are destructive · run only with a backup ready.
--   DROP INDEX CONCURRENTLY IF EXISTS "contradictions_resolved_category_created_at_idx";
--   DROP INDEX CONCURRENTLY IF EXISTS "contradictions_deleted_at_idx";
--   DROP INDEX CONCURRENTLY IF EXISTS "task_events_goal_id_created_at_idx";
--   DROP INDEX CONCURRENTLY IF EXISTS "voice_latency_events_assistant_id_stage_created_at_idx";
--   ALTER TABLE "contradictions" DROP COLUMN IF EXISTS "updated_at";
--   ALTER TABLE "contradictions" DROP COLUMN IF EXISTS "deleted_at";
--   ALTER TABLE "task_events" DROP COLUMN IF EXISTS "goal_id";

-- ═══════════════════════════════════════════════════════════════
-- 1. contradictions · updatedAt + deletedAt + composite + dropped-row index
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE "contradictions"
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3);

-- Backfill updated_at = created_at for existing rows (NULL would
-- break a NOT NULL constraint if we added one; we keep it nullable
-- and let Prisma's @updatedAt write fresh values on every change).
UPDATE "contradictions" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;

ALTER TABLE "contradictions"
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);

CREATE INDEX CONCURRENTLY IF NOT EXISTS "contradictions_resolved_category_created_at_idx"
  ON "contradictions" ("resolved", "category", "created_at");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "contradictions_deleted_at_idx"
  ON "contradictions" ("deleted_at");

-- ═══════════════════════════════════════════════════════════════
-- 2. task_events · denormalized goal_id + per-goal-feed index
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE "task_events"
  ADD COLUMN IF NOT EXISTS "goal_id" TEXT;

-- Backfill goal_id from the parent Task row · single UPDATE · indexed
-- subquery via the Task table primary key. Idempotent · runs only on
-- rows where goal_id IS NULL (new column · all rows initially NULL).
-- Note: actual table name is "Task" (PascalCase, no @@map override) ·
-- column is "goalId" (camelCase, no @map override).
UPDATE "task_events" te
  SET "goal_id" = t."goalId"
  FROM "Task" t
  WHERE te."taskId" = t."id"
    AND te."goal_id" IS NULL
    AND t."goalId" IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS "task_events_goal_id_created_at_idx"
  ON "task_events" ("goal_id", "created_at")
  WHERE "goal_id" IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════
-- 3. voice_latency_events · (assistant_id, stage, created_at) composite
-- ═══════════════════════════════════════════════════════════════
-- Note: this table is gated by the parked migration
-- 20260512_v526_voice_latency · the CREATE INDEX is conditional on
-- the table existing so this migration is safe to apply BEFORE or
-- AFTER the parent migration. PostgreSQL doesn't have native
-- "CREATE INDEX IF TABLE EXISTS" so we wrap in DO $$ ... END $$.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'voice_latency_events'
  ) THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS "voice_latency_events_assistant_id_stage_created_at_idx"
      ON "voice_latency_events" ("assistant_id", "stage", "created_at")';
  END IF;
END $$;
