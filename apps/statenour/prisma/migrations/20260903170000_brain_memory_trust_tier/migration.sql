-- Provenance trust tier for brain_memories.
--
-- Measured on prod 2026-09-03: ~2,179 rows carried `source` values that are
-- news sites (cleantechnica, electrek, cleveland-com, fox8-cleveland, wkyc-3,
-- inside-evs, car-driver) with created_by = 'system', all in category
-- 'industry_intel', and still being written that day. Recall did not filter on
-- source, so a scraped article was retrieved indistinguishably from something
-- the operator said.
--
-- That is provenance laundering: text enters as "something I read" and leaves
-- storage as "something I know", outliving the context window that would
-- otherwise have contained an injection.
--
-- DERIVED, not collected: `source` already encoded the answer at all 176 write
-- sites, so no writer changes. lib/brain/memory-trust.ts is the classifier;
-- this column materializes it so the filter runs in SQL BEFORE vector ranking.
--
-- Additive only. Nullable, no default, no data movement. Does not touch
-- vector_embeddings.embedding_vec* or the chat_messages tsvector column.

ALTER TABLE brain_memories ADD COLUMN IF NOT EXISTS trust_tier VARCHAR(20);

UPDATE brain_memories SET trust_tier = CASE
  WHEN lower(coalesce(created_by,'')) IN ('user','operator','nour') THEN 'OPERATOR'
  WHEN lower(coalesce(source,'')) IN ('cleantechnica','cleveland-com','electrek','fox8-cleveland','wkyc-3','inside-evs','car-driver') THEN 'EXTERNAL_CONTENT'
  WHEN lower(coalesce(source,'')) ~ '^(web:|rss:|scrape:|firecrawl|news:|telegram:|email:)' THEN 'EXTERNAL_CONTENT'
  WHEN lower(coalesce(source,'')) LIKE '%://%' THEN 'EXTERNAL_CONTENT'
  WHEN lower(coalesce(source,'')) ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$' THEN 'EXTERNAL_CONTENT'
  WHEN lower(coalesce(source,'')) IN ('manual','user','operator','nour') THEN 'OPERATOR'
  WHEN lower(coalesce(source,'')) ~ '^(nick|agent:|llm:|distillation|output_critic|judge-eval)' THEN 'AGENT_INFERRED'
  WHEN coalesce(source,'') = '' THEN 'EXTERNAL_CONTENT'
  ELSE 'SYSTEM_DERIVED' END
WHERE trust_tier IS NULL;

CREATE INDEX IF NOT EXISTS brain_memories_trust_tier_idx
  ON brain_memories (trust_tier) WHERE deleted_at IS NULL;
