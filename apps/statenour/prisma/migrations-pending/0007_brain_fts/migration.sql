-- 0007_brain_fts · 2026-06-02 · additive · zero data loss.
--
-- Expression GIN index powering the hybrid-retrieval LEXICAL lane in
-- lib/brain/contextual-recall.ts (real Postgres FTS via ts_rank +
-- websearch_to_tsquery, replacing the naive substring keywordScore lane).
--
-- SAFETY: brain_memories is a SEPARATE table from vector_embeddings (which
-- holds the pgvector HNSW column), so this index CANNOT touch pgvector. No new
-- column -> no Prisma schema drift. ~7K rows -> sub-second build. Idempotent
-- (IF NOT EXISTS) so re-running is a no-op.
CREATE INDEX IF NOT EXISTS "brain_memories_content_fts_idx"
  ON "brain_memories" USING GIN (to_tsvector('english', "content"));
