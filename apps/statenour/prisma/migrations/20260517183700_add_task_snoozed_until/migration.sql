-- v10.0.529.82 · Wave 26 · B1 · snooze persistence — catch-up migration
--
-- The `snoozedUntil` field landed in schema.prisma but no migration
-- file was ever produced, so prod Neon was missing the column. The
-- deployed Prisma client emits SELECTs that reference snoozed_until
-- on every Task query → 500 errors on /api/tasks, /api/actions-brain,
-- and any flow that read tasks.
--
-- Surfaced 2026-05-17 during Railway migration coherency audit.
-- Additive · nullable · no data backfill needed.

ALTER TABLE "Task" ADD COLUMN "snoozed_until" TIMESTAMP(3);
