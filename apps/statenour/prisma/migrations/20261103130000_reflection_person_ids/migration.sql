-- Reflections carry person ids . 2026-11-03 (job 2026-11-02-nour-os-interconnect, W8b)
-- NOT APPLIED. Operator/manager-run only (statenour-migration skill), via
-- scripts/apply-pending-migration.ts, then `prisma migrate resolve --applied
-- 20261103130000_reflection_person_ids` and a clean `prisma migrate status`.
-- ADDITIVE . one column with a constant default . no backfill . no existing
-- row or column touched . no DROP . no index (one user, a few hundred rows).
--
-- ORDER IS LOAD-BEARING: APPLY THIS BEFORE DEPLOYING THE MODEL CHANGE. Prisma
-- selects every scalar field on Reflection reads, so a client that knows
-- Reflection.personIds against a table without it fails every reflection
-- query (the /journal feed, the day view, the composer's own write).
--
-- The /journal composer (lib/services/journal-reflect.ts) now links people on
-- EVERY reflection, so this silo gets the column its writer fills. Old rows are
-- stamped, ids only, by scripts/backfill-journal-person-ids.ts (dry run default).

-- AlterTable (constant default: metadata-only in Postgres 11+, no rewrite)
ALTER TABLE "reflections" ADD COLUMN IF NOT EXISTS "person_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
