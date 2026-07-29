-- WP-13 · 2026-07-28 · Commitment lifecycle (blueprint batch).
-- All ADDITIVE + nullable: legacy rows stay valid; no defaults rewritten;
-- no data touched. Idempotent via IF NOT EXISTS so a re-run is a no-op.

ALTER TABLE "commitments" ADD COLUMN IF NOT EXISTS "success_condition" TEXT;
ALTER TABLE "commitments" ADD COLUMN IF NOT EXISTS "evidence_required" JSONB;
ALTER TABLE "commitments" ADD COLUMN IF NOT EXISTS "execution_ref" VARCHAR(128);
ALTER TABLE "commitments" ADD COLUMN IF NOT EXISTS "outcome_ref" VARCHAR(128);
ALTER TABLE "commitments" ADD COLUMN IF NOT EXISTS "source_ref" VARCHAR(190);
ALTER TABLE "commitments" ADD COLUMN IF NOT EXISTS "related_entities" JSONB;
ALTER TABLE "commitments" ADD COLUMN IF NOT EXISTS "verified_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "commitments_source_ref_idx" ON "commitments"("source_ref");
