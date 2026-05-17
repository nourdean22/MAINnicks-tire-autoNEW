-- v8.5 BATCH 27 · pgvector extension + native vector column
-- ============================================================
-- Phase 2B follow-up: ship the actual `vector` column on
-- vector_embeddings + the pgvector extension, so the v8.4
-- pgvector helper can swap from "available but unused" to
-- "active KNN search".
--
-- All operations gated with IF NOT EXISTS so the migration is
-- safe to re-run on Vercel cold starts where `prisma db push`
-- might have already applied parts of it.
--
-- Backfill strategy:
--   · The existing JSON `embedding` column stays — old code paths
--     keep working. The v8.4 pgvector helper writes BOTH columns.
--   · A backfill cron (separate batch) parses old JSON arrays and
--     populates `embedding_vec` for historical rows.
--
-- HNSW index:
--   · Built only after the column exists + has rows. We CREATE
--     the index but it's empty initially; HNSW handles incremental
--     adds gracefully.
--   · `vector_cosine_ops` matches the v8.4 helper's default `<=>` op.
-- ============================================================

-- 1. Enable the extension (Neon supports this; harmless if already enabled).
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Add the native vector column. 1536 dims = OpenAI text-embedding-3-small,
--    which is what `getEmbedding()` in lib/ai/provider.ts returns today.
--    Nullable so legacy rows don't fail the constraint.
ALTER TABLE "vector_embeddings"
  ADD COLUMN IF NOT EXISTS "embedding_vec" vector(1536);

-- 3. HNSW index for cosine-distance KNN. Build params tuned for
--    typical brain corpora (≤100K rows): m=16, ef_construction=64.
--    These are pgvector defaults and trade slightly slower build
--    for better recall.
CREATE INDEX IF NOT EXISTS "vector_embeddings_embedding_vec_hnsw_cosine_idx"
  ON "vector_embeddings"
  USING hnsw ("embedding_vec" vector_cosine_ops);

-- 4. Helper index for filter-then-knn queries (the v8.4 helper's
--    `WHERE sourceType = ? AND embedding_vec IS NOT NULL` path).
CREATE INDEX IF NOT EXISTS "vector_embeddings_source_type_vec_present_idx"
  ON "vector_embeddings"("sourceType")
  WHERE "embedding_vec" IS NOT NULL;
