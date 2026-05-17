-- v7.9 · Apr 29 · Universal soft-delete
-- ============================================================
-- Adds `deleted_at TIMESTAMP(3)` (nullable) + index on the 9
-- soft-delete-eligible tables. All operations use IF NOT EXISTS
-- so the migration is safe to re-run on already-migrated rows
-- (the `prisma db push --accept-data-loss` Vercel build path).
--
-- Soft-delete contract (enforced by lib/db/soft-delete.ts):
--   · `deletedAt = null`  → row is alive (default state)
--   · `deletedAt = now()` → row is hidden from default queries
--   · `deletedAt` cleared → row is restored
--
-- The index `WHERE deleted_at IS NULL` would be even cheaper, but
-- Prisma's @@index([deletedAt]) doesn't support partial indexes,
-- so we ship a regular b-tree on the column. Postgres still uses
-- it for the `deletedAt IS NULL` predicate.
-- ============================================================

-- 1. missions
ALTER TABLE "missions" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "missions_deleted_at_idx" ON "missions"("deleted_at");

-- 2. tasks
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "tasks_deleted_at_idx" ON "tasks"("deleted_at");

-- 3. mastery_decisions
ALTER TABLE "mastery_decisions" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "mastery_decisions_deleted_at_idx" ON "mastery_decisions"("deleted_at");

-- 4. commitments
ALTER TABLE "commitments" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "commitments_deleted_at_idx" ON "commitments"("deleted_at");

-- 5. brain_dumps
ALTER TABLE "brain_dumps" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "brain_dumps_deleted_at_idx" ON "brain_dumps"("deleted_at");

-- 6. brain_memories  (note: distinct from `expires_at` — that's TTL decay)
ALTER TABLE "brain_memories" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "brain_memories_deleted_at_idx" ON "brain_memories"("deleted_at");

-- 7. reflections
ALTER TABLE "reflections" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "reflections_deleted_at_idx" ON "reflections"("deleted_at");

-- 8. identity_snapshots
ALTER TABLE "identity_snapshots" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "identity_snapshots_deleted_at_idx" ON "identity_snapshots"("deleted_at");

-- 9. life_goals
ALTER TABLE "life_goals" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "life_goals_deleted_at_idx" ON "life_goals"("deleted_at");
