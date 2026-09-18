-- Rollback for 20260918011500_vector_embedding_fingerprint
-- Safe: the change is additive, nullable, and mutated no rows. Dropping it
-- loses only the fingerprints recorded since it was applied, and
-- lib/ai/tool-embeddings.ts degrades to treating every tool_catalog row as
-- stale — one extra re-embed pass, not a failure.
ALTER TABLE "vector_embeddings" DROP COLUMN IF EXISTS "contentFingerprint";
