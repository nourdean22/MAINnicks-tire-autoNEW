-- Task subtasks · Task.parentTaskId self-FK
-- 2026-05-23 · task #22 · per ADR-0017 · parked per WAVE-200
-- non-negotiable #1 ("No prod DB schema changes without a parked
-- migration first").
--
-- Adds a single-level subtask relationship to Task:
--   parent_task_id (nullable) → Task.id
--   index on (parent_task_id) for child lookups
--
-- Semantic rules documented in apps/statenour/docs/adr/0017-task-
-- subtask-semantics.md (operator decisions on completion cascade ·
-- field inheritance · UI surfacing · depth limit · mixed-kind
-- nesting · scoreboard rollup).
--
-- Apply to Neon prod when operator confirms connectivity:
--   1. Verify schema.prisma matches this migration (no other drift)
--   2. Confirm DATABASE_URL points at prod Neon (not localhost)
--   3. Run: tsx scripts/apply-pending-migration.ts \
--          20260523_task_parent_task_id
--      (uses autocommit driver · CREATE INDEX CONCURRENTLY doesn't
--      run inside Prisma's implicit transaction)
--   4. Run: pnpm prisma migrate resolve --applied \
--          20260523_task_parent_task_id
--   5. Verify: pnpm prisma migrate status (shows clean)
--   6. Add parentTaskId field to schema.prisma Task model:
--      ```prisma
--      parentTaskId String? @map("parent_task_id")
--      parent       Task?   @relation("TaskChildren",
--                            fields: [parentTaskId],
--                            references: [id],
--                            onDelete: SetNull)
--      children     Task[]  @relation("TaskChildren")
--
--      @@index([parentTaskId])
--      ```
--   7. Run pnpm prisma generate · pnpm typecheck
--   8. Ship the UI slice (LoopRowItem indent · LoopStream children
--      walk · derive-mission-matrix rollup · createTask inheritance)
--
-- Rollback is trivial · DROP the index + DROP the column. No data
-- loss (column is nullable · existing tasks have NULL · only new
-- subtask writes after schema-restore populate it).
--
-- Why not run inside a single BEGIN/COMMIT like 0001? · The CREATE
-- INDEX CONCURRENTLY statement cannot live inside a transaction.
-- The ALTER TABLE statements still wrap in a transaction for
-- atomicity · the index gets a separate concurrent build.

-- ── Step 1 · ALTER TABLE in a transaction (cheap · seconds) ──
BEGIN;

ALTER TABLE "Task"
  ADD COLUMN "parent_task_id" TEXT;

ALTER TABLE "Task"
  ADD CONSTRAINT "Task_parent_task_id_fkey"
  FOREIGN KEY ("parent_task_id")
  REFERENCES "Task"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;

COMMIT;

-- ── Step 2 · CREATE INDEX CONCURRENTLY outside the transaction ──
-- Concurrently because the Task table holds N rows and a blocking
-- CREATE INDEX would lock writes for the duration. CONCURRENTLY
-- is the standard prod-safe form. Cannot run inside a transaction
-- — that's why this statement is outside the BEGIN/COMMIT above.
CREATE INDEX CONCURRENTLY "Task_parent_task_id_idx"
  ON "Task"("parent_task_id");
