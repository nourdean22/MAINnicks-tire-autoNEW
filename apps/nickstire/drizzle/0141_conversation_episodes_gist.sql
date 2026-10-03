-- 0141 · conversation_episodes.gist — one plain sentence on what a counter conversation was ABOUT
--
-- WHY (2026-10-02). `summary` is built only from actionable facts (concern, requested work, quote,
-- promise, approval, decline, follow-up, vehicle detail) that cite a segment at >= 0.7 confidence.
-- Every office episode on 2026-10-02 stored 0 facts and 0 summaries, so Admin -> Lot showed
-- "No evidence-backed actionable facts were found" even for fully transcribed conversations and the
-- operator could not see what anyone was talking about. The gist is the extractor's one-sentence
-- topic ("Customer asking when their car will be ready"), cited to real segments and withheld on
-- the same coverage / audio-level gates as facts (services/conversationFacts.ts).
--
-- NULL = no gist (none produced, withheld by a gate, or the episode predates this column).
-- Additive, nullable, idempotent. Code ships first and checks information_schema before writing
-- or selecting it. Applied through Admin -> Run migrations (server/routers/nick/intelligence.ts
-- carries the same statement).

ALTER TABLE conversation_episodes ADD COLUMN IF NOT EXISTS gist TEXT NULL;
