-- BrainMemory temporal validity + supersession · 2026-08-14 · BDN-310
-- ADDITIVE, zero data loss, zero backfill. NOT YET APPLIED — see below.
--
-- WHY
-- BrainMemory has three time fields and none of them can say "this was
-- true, then stopped being true":
--   expires_at  = decay TTL           (we stop trusting it)
--   deleted_at  = explicit removal    (it should not have been there)
--   last_seen   = last OBSERVED       (bumped by recall, so it measures
--                                      attention, not confirmation)
-- The missing concept is SUPERSESSION. A memory whose validity ended is
-- not wrong and must never be deleted — it is the evidence that the thing
-- CHANGED. Retrieving "Nour's target is 186 lbs" after that target moved
-- is not a recall failure; it is a recall SUCCESS reported without its
-- expiry. That gap is the difference between a system that remembers more
-- and one that is wiser.
--
-- DESIGN NOTES
-- * valid_until NULL  = still believed. Absence means "no known end",
--   never "unknown" — an explicitly unknown end stays NULL and is
--   distinguished by last_verified_at being NULL too.
-- * superseded_by_id is a SELF-REFERENCE and is deliberately NOT a foreign
--   key with ON DELETE CASCADE. If the replacement is later hard-deleted
--   we want a dangling pointer we can detect, not a silent cascade that
--   erases the history of a change. ON DELETE SET NULL keeps the row.
-- * No UNIQUE on superseded_by_id: several narrow memories can be
--   superseded by one broader consolidated memory. Enforcing 1:1 here
--   would forbid consolidation, which is the common case.
-- * Contradictions are PRESERVED, never merged: a conflicting write ends
--   the old row's validity and links forward. Both rows survive.
--
-- SCOPE
-- Application code gates which categories participate (commitments,
-- identity, financial, safety, active missions). Keeping the gate in code
-- rather than in a CHECK constraint means widening the scope later needs
-- no second migration.
--
-- INDEXES
-- The partial index is the one that matters: recall filters
-- "still-valid" on nearly every query, and a partial index over
-- valid_until IS NULL stays small even as the table grows, because the
-- superseded tail never enters it.
--
-- Every statement is IF NOT EXISTS / IF EXISTS so a re-run is a no-op.
--
-- ============================ NOT APPLIED ============================
-- statenour migrations are HAND-APPLIED and DDL is a protected operation.
-- This file was authored under operator approval but deliberately NOT run
-- against Neon by the agent. To apply:
--   psql "$DATABASE_URL" -f prisma/migrations/20260814120000_brain_memory_supersession/migration.sql
-- Then `pnpm prisma generate`. Rollback is at the bottom of this file.
-- =====================================================================

ALTER TABLE "BrainMemory" ADD COLUMN IF NOT EXISTS "valid_from" TIMESTAMP(3);
ALTER TABLE "BrainMemory" ADD COLUMN IF NOT EXISTS "valid_until" TIMESTAMP(3);
ALTER TABLE "BrainMemory" ADD COLUMN IF NOT EXISTS "last_verified_at" TIMESTAMP(3);
ALTER TABLE "BrainMemory" ADD COLUMN IF NOT EXISTS "superseded_by_id" TEXT;

-- Self-reference. SET NULL, never CASCADE — see design notes above.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BrainMemory_superseded_by_id_fkey'
  ) THEN
    ALTER TABLE "BrainMemory"
      ADD CONSTRAINT "BrainMemory_superseded_by_id_fkey"
      FOREIGN KEY ("superseded_by_id") REFERENCES "BrainMemory"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Hot path: "give me the still-valid memories". Partial, so the
-- superseded tail never enters the index.
CREATE INDEX IF NOT EXISTS "BrainMemory_active_validity_idx"
  ON "BrainMemory" ("category", "confidence")
  WHERE "valid_until" IS NULL AND "deleted_at" IS NULL;

-- Walking a supersession chain forward, and auditing dangling pointers.
CREATE INDEX IF NOT EXISTS "BrainMemory_superseded_by_id_idx"
  ON "BrainMemory" ("superseded_by_id")
  WHERE "superseded_by_id" IS NOT NULL;

-- Staleness sweeps: "what have we not re-verified in N days?"
CREATE INDEX IF NOT EXISTS "BrainMemory_last_verified_at_idx"
  ON "BrainMemory" ("last_verified_at");

-- NO BACKFILL. Existing rows keep all four columns NULL, which reads as
-- "no known validity window, never explicitly verified" — the honest
-- state. Backfilling valid_from = created_at would manufacture a
-- provenance claim the system never actually observed, which is exactly
-- the fabrication class the TRUTH RULE exists to prevent.

-- ROLLBACK (safe: additive-only, no data depends on these yet)
-- DROP INDEX IF EXISTS "BrainMemory_last_verified_at_idx";
-- DROP INDEX IF EXISTS "BrainMemory_superseded_by_id_idx";
-- DROP INDEX IF EXISTS "BrainMemory_active_validity_idx";
-- ALTER TABLE "BrainMemory" DROP CONSTRAINT IF EXISTS "BrainMemory_superseded_by_id_fkey";
-- ALTER TABLE "BrainMemory" DROP COLUMN IF EXISTS "superseded_by_id";
-- ALTER TABLE "BrainMemory" DROP COLUMN IF EXISTS "last_verified_at";
-- ALTER TABLE "BrainMemory" DROP COLUMN IF EXISTS "valid_until";
-- ALTER TABLE "BrainMemory" DROP COLUMN IF EXISTS "valid_from";
