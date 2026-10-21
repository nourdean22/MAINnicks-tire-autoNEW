-- 0149 · conversation_episodes.extraction — how a conversation's account and flags were produced
--
-- WHY (2026-10-21, ears-v2). The gist column now holds a detailed ACCOUNT of what happened, with
-- guesses labelled "(inferred: ...)" and unheard stretches named "[inaudible: ...]", and "worth
-- knowing" flags are stored as facts whose quote must be in the segment they cite
-- (server/services/conversationFacts.ts). This column records, per episode, which model and
-- prompt version produced that, whether the clip was noise only, how many flags were kept and
-- why the rest were dropped: { model, promptVersion, noiseOnly, flagCount, dropped: [{reason,count}] }.
-- Counts and reasons only, never words.
--
-- NULL = not recorded (extraction failed, or the episode predates this column).
-- Additive, nullable, idempotent. Code ships first and checks information_schema before writing
-- it. Applied through Admin -> Run migrations (server/routers/nick/intelligence.ts carries the
-- same statement).

ALTER TABLE conversation_episodes ADD COLUMN IF NOT EXISTS extraction JSON NULL;
