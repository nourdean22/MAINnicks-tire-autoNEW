-- 0005_people_overhaul · People page → mastery integration
-- 2026-06-01 · statenour/people-overhaul wave
--
-- Two additive, fully-reversible schema changes + one data backfill:
--   1. person_profiles.pending_classification (JSONB, nullable)
--      — the suggest-then-approve classifier writes its proposal here
--      instead of silently overwriting role/leverageNotes/trustScore.
--   2. "Task".person_id (TEXT, nullable, FK → person_profiles.id)
--      — structured upgrade of the free-text promiseTo string so
--      /people can surface "open promises to X" + credit reps.
--   3. Backfill person_id from existing promiseTo name-matches.
--
-- pgvector-safe: touches only ordinary columns. NEVER run via
-- `prisma db push --accept-data-loss` (drops embedding_vec*).
--
-- Apply to Neon prod (operator-confirmed connectivity):
--   set -a && . ./.env.local && set +a
--   pnpm tsx scripts/apply-pending-migration.ts \
--     prisma/migrations-pending/0005_people_overhaul/migration.sql
--   pnpm prisma migrate resolve --applied 0005_people_overhaul
--   pnpm prisma migrate status   # clean
--   pnpm prisma generate && pnpm typecheck
--
-- Rollback (trivial · all nullable, no data loss on existing rows):
--   DROP INDEX CONCURRENTLY IF EXISTS "Task_person_id_idx";
--   ALTER TABLE "Task" DROP CONSTRAINT IF EXISTS "Task_person_id_fkey";
--   ALTER TABLE "Task" DROP COLUMN IF EXISTS "person_id";
--   ALTER TABLE "person_profiles" DROP COLUMN IF EXISTS "pending_classification";

-- apply-pending-migration.ts runs each statement in AUTOCOMMIT (its own
-- implicit tx) and treats "already exists" as a warn-and-continue. So we
-- deliberately do NOT wrap these in BEGIN/COMMIT: that keeps the FK
-- ADD CONSTRAINT failure on a re-run fully isolated (it can't poison or
-- roll back the idempotent column adds, which would happen inside a shared
-- aborted transaction). First-run order still holds: columns, then FK.

-- ── Step 1 · columns (idempotent) ──
ALTER TABLE "person_profiles"
  ADD COLUMN IF NOT EXISTS "pending_classification" JSONB;

ALTER TABLE "Task"
  ADD COLUMN IF NOT EXISTS "person_id" TEXT;

-- ADD CONSTRAINT has no IF NOT EXISTS in Postgres; a re-run surfaces
-- "already exists", which apply-pending-migration.ts treats as a warn.
ALTER TABLE "Task"
  ADD CONSTRAINT "Task_person_id_fkey"
  FOREIGN KEY ("person_id")
  REFERENCES "person_profiles"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

-- ── Step 2 · backfill person_id from promiseTo name-matches ──
-- Case-insensitive exact match. Ad-hoc / "myself" promiseTo strings
-- that don't match a profile simply stay unlinked (person_id NULL).
UPDATE "Task" t
  SET "person_id" = p.id
  FROM "person_profiles" p
  WHERE lower(t."promiseTo") = lower(p.name)
    AND t."person_id" IS NULL
    AND t."promiseTo" IS NOT NULL
    AND p."deletedAt" IS NULL;

-- ── Step 3 · CREATE INDEX CONCURRENTLY outside the transaction ──
CREATE INDEX CONCURRENTLY IF NOT EXISTS "Task_person_id_idx"
  ON "Task"("person_id");
