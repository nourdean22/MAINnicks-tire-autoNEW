-- Tool-selection telemetry: a skipped semantic tier is not a cold cache.
--
-- Safe to apply: one additive nullable column on the telemetry table. Existing
-- rows remain unknown-to-this-version as NULL, and no product table,
-- pgvector column, generated tsvector column, index, or data is removed.
ALTER TABLE tool_selection_turns
  ADD COLUMN IF NOT EXISTS semantic_tier_attempted BOOLEAN;
