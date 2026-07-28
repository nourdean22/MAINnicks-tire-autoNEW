-- 2026-07-28 · intelligence_outcomes — the outcome ledger (S4).
-- Purely ADDITIVE: one table + two indexes. pgvector/tsvector extras
-- untouched by construction.

CREATE TABLE IF NOT EXISTS "intelligence_outcomes" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "source_engine" TEXT NOT NULL,
  "content_hash" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "evidence_refs" JSONB,
  "confidence" DOUBLE PRECISION,
  "shown_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "shown_surface" TEXT NOT NULL,
  "decided_at" TIMESTAMP(3),
  "decision" TEXT,
  "result_ref" TEXT,
  "outcome_at" TIMESTAMP(3),
  "outcome_useful" BOOLEAN,
  "conversation_id" TEXT,
  "trace_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "intelligence_outcomes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "intelligence_outcomes_kind_shown_at_idx" ON "intelligence_outcomes"("kind", "shown_at");
CREATE INDEX IF NOT EXISTS "intelligence_outcomes_content_hash_idx" ON "intelligence_outcomes"("content_hash");
