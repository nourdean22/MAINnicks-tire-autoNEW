-- v7 cleanup · Apr 28 · Performance indexes for the 3 slow-query tables
-- observed in dev preview (3-6s queries on ~50K row tables).
--
-- 1. system_metrics — dashboard sparklines filter by createdAt range
-- 2. autonomous_actions — health-digest counts by result over 24h
-- 3. brain_memories — category-by-recency reads dominate brain recall
--
-- All three are CREATE INDEX IF NOT EXISTS so re-runs are no-ops.

CREATE INDEX IF NOT EXISTS "system_metrics_createdAt_idx" ON "system_metrics" ("created_at");
CREATE INDEX IF NOT EXISTS "autonomous_actions_result_createdAt_idx" ON "autonomous_actions" ("result", "createdAt");
CREATE INDEX IF NOT EXISTS "brain_memories_category_createdAt_idx" ON "brain_memories" ("category", "created_at");
