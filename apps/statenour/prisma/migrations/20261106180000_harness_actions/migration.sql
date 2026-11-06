-- Harness control queue . 2026-11-06 (job 2026-11-06-harness-control-nick-node)
-- NOT APPLIED. Operator/manager-run only (statenour-migration skill): the Owner Panel's guarded
-- POST /api/system/apply-pending-migration { "name": "20261106180000_harness_actions" }, or
-- scripts/apply-pending-migration.ts, then `prisma migrate resolve --applied 20261106180000_harness_actions`
-- and a clean `prisma migrate status`.
-- ADDITIVE . one new table and its indexes . no existing table, row or column touched . no DROP.
--
-- Deploy-safe in either order: lib/services/harness-control.ts reads Prisma P2021 (table missing) as
-- "not migrated yet" and answers 503 on the control doors; the snapshot door and the harness card do
-- not touch this table, and the card shows the action list as unread, never as empty.

CREATE TABLE IF NOT EXISTS "harness_actions" (
  "id" TEXT NOT NULL,
  "request_key" VARCHAR(80) NOT NULL,
  "pc" VARCHAR(20) NOT NULL,
  "action" VARCHAR(40) NOT NULL,
  "status" VARCHAR(12) NOT NULL DEFAULT 'QUEUED',
  "requested_by" VARCHAR(40) NOT NULL,
  "reason" VARCHAR(200),
  "expires_at" TIMESTAMP(3) NOT NULL,
  "claimed_at" TIMESTAMP(3),
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  "exit_code" INTEGER,
  "output" TEXT,
  "error" VARCHAR(400),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "harness_actions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "harness_actions_request_key_key" ON "harness_actions"("request_key");

CREATE INDEX IF NOT EXISTS "harness_actions_pc_status_created_at_idx" ON "harness_actions"("pc", "status", "created_at");

CREATE INDEX IF NOT EXISTS "harness_actions_created_at_idx" ON "harness_actions"("created_at");
