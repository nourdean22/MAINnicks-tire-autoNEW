-- Journal entries carry person ids . 2026-11-02 (job 2026-11-02-nour-os-interconnect, W4)
-- NOT APPLIED. Operator/manager-run only (statenour-migration skill), via
-- scripts/apply-pending-migration.ts, then `prisma migrate resolve --applied
-- 20261102200000_brain_dump_person_ids` and a clean `prisma migrate status`.
-- ADDITIVE . one column with a constant default . no backfill . no existing
-- row or column touched . no DROP . no index (one user, a few hundred rows; a
-- GIN index on person_ids is the upgrade if the /people read ever slows).
--
-- ORDER IS LOAD-BEARING: APPLY THIS BEFORE DEPLOYING THE MODEL CHANGE. Prisma
-- selects every scalar field on BrainDump reads, so a client that knows
-- BrainDump.personIds against a table without it fails every journal query.
--
-- Only brain_dumps: it is the one journal silo whose writer extracts people
-- (lib/brain/journal-ingest.ts). reflections get the column when a writer does.

-- AlterTable (constant default: metadata-only in Postgres 11+, no rewrite)
ALTER TABLE "brain_dumps" ADD COLUMN IF NOT EXISTS "person_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
