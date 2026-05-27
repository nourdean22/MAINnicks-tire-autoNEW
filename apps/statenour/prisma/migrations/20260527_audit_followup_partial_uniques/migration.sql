-- 2026-05-27 · audit follow-up · partial unique indexes for race-condition guards
--
-- Source: post-ghost-goal code-explorer audit, Findings #11 + #12.
-- Two HIGH-severity race conditions where app-code "uniqueness" is
-- the only enforcement layer, and concurrent cron writes (or manual
-- re-trigger overlapping the cron) can silently corrupt the brain
-- layer's source of truth:
--
-- 1. Reflection (table: reflections) · the dedup is enforced by
--    `idempotencyKey` in application code only. No DB constraint.
--    Two crons firing on the same {date, scope, category} can both
--    write a row. /api/brain/reflections then returns ambiguous
--    `findFirst` results.
--
-- 2. IdentitySnapshot (table: identity_snapshots) · per the schema
--    comment at line 1970-1972, `@unique` was REMOVED in v7.9 so
--    soft-delete could re-emit today's row. App code at lib/brain/
--    thinking-engine.ts:165 enforces uniqueness with `findFirst({
--    date, deletedAt: null })`. No DB constraint. Refresh-identity
--    and brain-cycle crons can both touch identity within seconds —
--    any overlap window silently writes two non-deleted snapshots
--    for the same date and the 8-axis self-model becomes ambiguous.
--
-- THE FIX · partial unique indexes (Postgres-specific syntax) that
-- only enforce uniqueness on rows where `deleted_at IS NULL`. This
-- preserves the v7.9 design intent (a soft-deleted row at date X
-- coexists with a fresh live row at date X — that's the redo path)
-- while plugging the race-condition hole for live rows.
--
-- Prisma's schema DSL does NOT support partial uniques — so the
-- schema.prisma stays declaring `@@index([date, scope])` etc. The
-- partial unique lives ONLY at the DB level. Application code is
-- already using `findFirst({deletedAt: null})` so no client change
-- is needed. The index name carries `_alive` so future devs see it's
-- a partial constraint, not a regular @@unique.
--
-- PRE-FLIGHT CLEANUP · before adding the partial uniques, soft-delete
-- any existing live duplicates (keeping the most-recent createdAt as
-- the canonical row). Without this the CREATE UNIQUE INDEX would
-- fail on duplicate-key error if duplicates already exist. The
-- DISTINCT ON pattern is a standard PG idiom for "newest per group."
--
-- ADDITIVE · the index creation is non-destructive. Cleanup soft-
-- deletes; the row remains. Rollback drops the indexes; the cleanup
-- can be undone by setting deleted_at = NULL on the marked rows
-- (timestamps in the comment make them findable).
--
-- HOW TO APPLY
-- ─────────────────────────────────────────────────────────────────
--   set -a && . ./.env.local && set +a
--   pnpm tsx scripts/apply-pending-migration.ts \
--     prisma/migrations/20260527_audit_followup_partial_uniques/migration.sql
--   pnpm exec prisma migrate resolve \
--     --applied 20260527_audit_followup_partial_uniques
--   pnpm exec prisma migrate status   # should be clean
--
-- VERIFICATION (run after apply)
-- ─────────────────────────────────────────────────────────────────
--   SELECT indexname, indexdef FROM pg_indexes
--     WHERE tablename IN ('reflections', 'identity_snapshots')
--     AND indexname LIKE '%_alive%';
--   -- Should return 2 rows.
--
-- ROLLBACK
-- ─────────────────────────────────────────────────────────────────
--   DROP INDEX IF EXISTS reflections_date_scope_category_alive_idx;
--   DROP INDEX IF EXISTS identity_snapshots_date_alive_idx;
--   -- To undo the cleanup, find the marked rows:
--   -- SELECT id, date, scope, category FROM reflections
--   --   WHERE deleted_at >= '2026-05-27' AND deleted_at < '2026-05-28';
--   -- Then UPDATE deleted_at = NULL on the ones you want restored.

BEGIN;

-- ─────────────────────────────────────────────────────────────────
-- Step 1 · Cleanup duplicate live reflections.
-- Keep the most-recent createdAt as canonical · soft-delete the rest.
-- ─────────────────────────────────────────────────────────────────
WITH canonical AS (
  SELECT DISTINCT ON (date, scope, category) id
  FROM reflections
  WHERE deleted_at IS NULL
  ORDER BY date, scope, category, created_at DESC
)
UPDATE reflections
SET deleted_at = NOW()
WHERE deleted_at IS NULL
  AND id NOT IN (SELECT id FROM canonical);

-- ─────────────────────────────────────────────────────────────────
-- Step 2 · Cleanup duplicate live identity snapshots.
-- Same pattern · keyed only on date.
-- ─────────────────────────────────────────────────────────────────
WITH canonical AS (
  SELECT DISTINCT ON (date) id
  FROM identity_snapshots
  WHERE deleted_at IS NULL
  ORDER BY date, created_at DESC
)
UPDATE identity_snapshots
SET deleted_at = NOW()
WHERE deleted_at IS NULL
  AND id NOT IN (SELECT id FROM canonical);

-- ─────────────────────────────────────────────────────────────────
-- Step 3 · Partial unique on reflections (date, scope, category)
-- where deleted_at IS NULL.
-- ─────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS reflections_date_scope_category_alive_idx
  ON reflections (date, scope, category)
  WHERE deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────
-- Step 4 · Partial unique on identity_snapshots (date)
-- where deleted_at IS NULL.
-- ─────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS identity_snapshots_date_alive_idx
  ON identity_snapshots (date)
  WHERE deleted_at IS NULL;

COMMIT;
