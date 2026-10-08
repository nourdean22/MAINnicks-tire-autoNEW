-- device_events identity indexes · camera audit 2026-10-07 (vehicle lane hardening)
-- NOT APPLIED. Parked here until the operator instructs the apply.
-- ADDITIVE · two indexes on an existing table · no ALTER, no DROP, no backfill, no row touched.
--
-- WHY THIS EXISTS
-- lib/services/vehicle-detection.ts dedupes a retried edge event by reading
-- data->>'eventId' with findFirst before it writes. Two retries of one event that
-- arrive together both read "nothing there" and both write: two rows, two pages.
-- Nothing in the database said an eventId may exist once per device. The unique
-- index says it; the service catches the P2002 it raises and answers with the row
-- that won.
--
-- The second index makes the visitId lookup (same JSON path, same shape) cheap,
-- so the service's visit window can grow from 12 hours to 7 days: a car dropped
-- Friday evening and finished Monday is ONE visit, and before this the Monday
-- update opened a second row because the first had left the window.
--
-- Prisma cannot express an expression index, so neither is in schema.prisma.
-- lib/db/schema-sentinel.ts carries the unique one as a partial_unique
-- expectation: a `db push` that drops it is reported on /system/health, not silent.
--
-- PREFLIGHT (read-only). The unique CREATE fails on existing duplicates, and the
-- guarded endpoint stops and reports that instead of pretending (see
-- lib/db/migration-apply-safety.ts). Find them first:
--   SELECT device_id, data->>'eventId' AS event_id, COUNT(*)
--     FROM device_events
--    WHERE data->>'eventId' IS NOT NULL
--    GROUP BY 1, 2
--   HAVING COUNT(*) > 1;
-- Deduplicating is a DELETE against operator data and is deliberately not automated.
--
-- APPLY (operator): POST /api/system/apply-pending-migration
-- { "name": "20261007120000_device_events_identity_indexes" } from the authed app tab,
-- or pnpm tsx scripts/apply-pending-migration.ts <this file>. Confirm both names in
-- pg_indexes, promote this dir to prisma/migrations/, then
-- `prisma migrate resolve --applied 20261007120000_device_events_identity_indexes`
-- and `prisma migrate status`. BOTH HALVES OR NEITHER (see README.md here).
--
-- ROLLBACK: DROP INDEX IF EXISTS "device_events_device_id_event_id_uniq";
--           DROP INDEX IF EXISTS "device_events_device_id_visit_id_idx";
-- An index holds no data; both are lossless and reconstructible.

CREATE UNIQUE INDEX IF NOT EXISTS "device_events_device_id_event_id_uniq"
  ON "device_events" ("device_id", ("data"->>'eventId'))
  WHERE "data"->>'eventId' IS NOT NULL;

CREATE INDEX IF NOT EXISTS "device_events_device_id_visit_id_idx"
  ON "device_events" ("device_id", ("data"->>'visitId'))
  WHERE "data"->>'visitId' IS NOT NULL;
