-- v10.0.462 · adds `updatedAt` column to 8 confirmed-mutable models.
--
-- Audit provenance: schema-timestamp-audit (v10.0.451) flagged 11
-- "possibly mutable" candidates. v10.0.462 spawned a code-explorer
-- agent to read each model's update sites and classify:
--   · 8 MUTABLE · need updatedAt · this migration
--   · 1 MUTABLE · already tracked via domain-specific field
--     (ChatMessage.editedAt — no migration needed)
--   · 2 IMMUTABLE · zero update sites in the codebase
--     (CommandResolution · ToolVerbRatio — no migration needed)
--
-- Per-model evidence is captured in the v10.0.462 commit body.
-- Each ALTER TABLE is independently rollback-safe; partial-apply
-- failure on row N stops at the failed table, leaving rows 1..N-1
-- with the new column.
--
-- The DEFAULT NOW() on the new columns means existing rows get the
-- migration moment as their initial updatedAt. The @updatedAt
-- directive in schema.prisma will start tracking actual mutations
-- on the next write to each row.

-- 1 · MissionLink (mission_links)
ALTER TABLE "mission_links"
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 2 · WorkResult (WorkResult — no @@map · default PascalCase)
ALTER TABLE "WorkResult"
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 3 · MasteryScore (mastery_scores)
ALTER TABLE "mastery_scores"
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 4 · BodyTracking (body_tracking)
ALTER TABLE "body_tracking"
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 5 · FinancialSnapshot (financial_snapshots)
ALTER TABLE "financial_snapshots"
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 6 · BrainDump (brain_dumps)
ALTER TABLE "brain_dumps"
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 7 · Contradiction (contradictions)
ALTER TABLE "contradictions"
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 8 · VectorEmbedding (vector_embeddings)
ALTER TABLE "vector_embeddings"
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
