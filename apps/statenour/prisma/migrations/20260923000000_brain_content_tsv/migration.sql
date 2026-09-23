-- 20260923000000_brain_content_tsv · 2026-09-22 · ADDITIVE · zero data loss · pgvector untouched.
--
-- brain_memories gets a STORED generated tsvector (content_tsv) plus a GIN over it, so the three
-- brain full-text readers (lib/brain/contextual-recall.ts, lib/brain/memory-recall.ts,
-- lib/ai/tools/brain.ts) filter AND rank on a parsed vector instead of re-parsing `content`
-- for every candidate row inside ts_rank.
--
-- Measured on production 2026-09-22 (EXPLAIN ANALYZE, warm cache, the chat lane's OR-of-topics
-- shape, 3,603 candidate rows after the GIN + validity filters):
--   · with ts_rank(to_tsvector('english', content), q) ....... 1,902 ms
--   · the identical query with the rank removed ..............     8 ms
--   · the same query on content_tsv (Neon branch rehearsal) ..    21 ms
-- The lexical lane's 900 ms statement_timeout was therefore dropping the lane on 84 of 89 hybrid
-- benchmark queries and ~36% of sequential production-shaped probes. Same set of matching rows
-- before and after (6,087 = 6,087 on the rehearsal branch): this is a speed change, not a
-- ranking change - the generation expression is EXACTLY the readers' former inline expression.
--
-- COST OF APPLYING (rehearsed 2026-09-22 on a Neon branch clone of production, 57,230 rows,
-- 0.25-2 CU compute, cold): the ALTER rewrites the table under an ACCESS EXCLUSIVE lock for
-- ~29 s; the GIN build takes ~6 s. Apply at a quiet minute with the autocommit runner
--   railway run -s statenour-web -- pnpm exec tsx scripts/apply-pending-migration.ts \
--     prisma/migrations/20260923000000_brain_content_tsv/migration.sql
-- then record it: railway run -s statenour-web -- pnpm prisma migrate resolve --applied 20260923000000_brain_content_tsv
-- and re-verify with EXPLAIN ANALYZE that the lane's query reads brain_memories_content_tsv_idx.
--
-- Prisma guard: schema.prisma declares `content_tsv Unsupported("tsvector")? @default(dbgenerated())`
-- (the chat_messages.searchable_tsv pattern) so db push cannot drop it; lib/db/schema-sentinel.ts
-- expects both the column and the index. The old expression index brain_memories_content_fts_idx
-- (86 MB) is left in place - retiring it is an operator decision once every reader is on the column.
--
-- Idempotent: both statements are IF NOT EXISTS, a re-run is a no-op.
--
-- APPLIED TO PRODUCTION 2026-09-23 00:22:35Z-00:23:15Z (operator-authorised, the autocommit runner above):
-- ok=2 warned=0 failed=0; recorded with `prisma migrate resolve --applied`, `migrate status` = 64 migrations,
-- up to date. Verified read-only right after: generation_expression = to_tsvector('english'::regconfig,
-- content), brain_memories_content_tsv_idx valid at 64 MB, 57,230 rows, 0 NULL vectors, heap 65 -> 44 MB,
-- 6,087 = 6,087 matches via column and expression, and the lane's query EXPLAIN ANALYZE = 25.6 ms through
-- brain_memories_content_tsv_idx (was 1,902 ms).

ALTER TABLE "brain_memories"
  ADD COLUMN IF NOT EXISTS "content_tsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', "content")) STORED;

CREATE INDEX IF NOT EXISTS "brain_memories_content_tsv_idx"
  ON "brain_memories" USING GIN ("content_tsv");
