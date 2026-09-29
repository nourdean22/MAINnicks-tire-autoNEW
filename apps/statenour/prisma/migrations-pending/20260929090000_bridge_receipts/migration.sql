-- bridge_receipts · ADR-0019 phase 0b (receiver first) · 2026-09-29
-- NOT APPLIED. Parked here until the operator instructs the apply.
-- ADDITIVE · one new table + one index · no ALTER, no DROP, no backfill.
-- Generated with `prisma migrate diff --from-schema-datamodel <main> --to-schema-datamodel
-- prisma/schema.prisma --script`; IF NOT EXISTS added so a re-run is a no-op.
--
-- WHY THIS EXISTS
-- No nickstire -> statenour write carries a key the receiver can dedupe on
-- (docs/adr/0019-idempotent-bridge-writes.md §2.2). This table records each
-- Idempotency-Key once; a replay increments seen_count instead of writing a
-- second reality_events / evidence_claims / tasks row.
--
-- ORDER: unlike an added COLUMN, a new TABLE is safe to land in the Prisma
-- model before this DDL runs. Only reads/writes of bridge_receipts fail (P2021),
-- and lib/services/bridge-receipts.ts treats P2021 as "not migrated" and falls
-- back to today's un-deduplicated write. No sender sends the key yet either.
--
-- APPLY (operator): pnpm tsx scripts/apply-pending-migration.ts <this file>,
-- confirm the table in information_schema, promote this dir to
-- prisma/migrations/, then `prisma migrate resolve --applied 20260929090000_bridge_receipts`
-- and `prisma migrate status`. BOTH HALVES OR NEITHER (see README.md here).

CREATE TABLE IF NOT EXISTS "bridge_receipts" (
    "idempotency_key" VARCHAR(190) NOT NULL,
    "route" VARCHAR(64) NOT NULL,
    "result_ref" VARCHAR(120),
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seen_count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "bridge_receipts_pkey" PRIMARY KEY ("idempotency_key")
);

CREATE INDEX IF NOT EXISTS "bridge_receipts_first_seen_at_idx" ON "bridge_receipts"("first_seen_at");
