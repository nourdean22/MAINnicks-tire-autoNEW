-- Task notes + photo attachments . 2026-10-29 (job 2026-10-29-task-upgrades)
-- NOT APPLIED. Operator/manager-run only (statenour-migration skill), via
-- scripts/apply-pending-migration.ts, then `prisma migrate resolve --applied
-- 20261029180000_task_notes_attachments` and a clean `prisma migrate status`.
-- ADDITIVE . one nullable column, one new table . no default on Task . no
-- backfill . no existing row or column touched . no DROP.
--
-- ORDER IS LOAD-BEARING: APPLY THIS BEFORE DEPLOYING THE MODEL CHANGE. Prisma
-- selects every scalar field on Task reads and writes, so a client that knows
-- Task.notes against a table without it fails every Task query repo-wide.
--
-- Body = `prisma migrate diff` (offline, main schema -> this schema), with the
-- foreign key and a CHECK moved inline into CREATE TABLE so that every statement
-- is IF NOT EXISTS and a re-run is a no-op.
--
-- task_attachments_byte_size_check: the 512 KB per-image cap, enforced by the
-- database as well as the upload service. Prisma cannot express a CHECK, so it
-- lives here only; `db push` does not introspect or drop CHECK constraints.

-- AlterTable (nullable, no default: metadata-only in Postgres, no rewrite)
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "notes" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "task_attachments" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "kind" VARCHAR(16) NOT NULL DEFAULT 'photo',
    "mime_type" VARCHAR(32) NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sha256" VARCHAR(64) NOT NULL,
    "data" BYTEA NOT NULL,
    "caption" VARCHAR(500),
    "created_by" VARCHAR(64) DEFAULT 'user',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "task_attachments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "task_attachments_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "task_attachments_byte_size_check" CHECK ("byte_size" BETWEEN 1 AND 524288 AND octet_length("data") = "byte_size")
);

-- CreateIndex (dedupe key for idempotent upload; also serves task_id lookups)
CREATE UNIQUE INDEX IF NOT EXISTS "task_attachments_task_id_sha256_key" ON "task_attachments"("task_id", "sha256");
