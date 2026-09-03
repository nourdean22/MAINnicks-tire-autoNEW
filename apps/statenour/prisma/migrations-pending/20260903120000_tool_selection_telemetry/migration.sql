-- Tool SELECTION telemetry (distinct from tool EXECUTION telemetry in tool_telemetry).
--
-- Why: lib/ai/chat-mode.ts pruneTools() selects <=NICK_TOOL_BUDGET (default 24) of 181
-- tools via a 6-tier cascade whose tier 4 is ~40 hand-written regexes. Nothing recorded
-- which tools were dropped, which tier selected a tool, whether the budget truncated the
-- candidate set, or whether tier 5 (semantic) silently no-opped on a cold embedding cache.
-- That made the pruner's quality unmeasurable and forced reactive, one-anecdote-at-a-time
-- regex maintenance.
--
-- Safe to apply: two new tables, no changes to existing objects, no data movement.
-- Does NOT touch vector_embeddings.embedding_vec* or the chat_messages tsvector column.

CREATE TABLE IF NOT EXISTS tool_selection_turns (
  id                    TEXT PRIMARY KEY,
  turn_id               TEXT NOT NULL,
  conversation_id       TEXT,
  mode                  VARCHAR(24) NOT NULL,
  candidate_count       INTEGER NOT NULL,
  selected_count        INTEGER NOT NULL,
  budget                INTEGER NOT NULL,
  budget_truncated      BOOLEAN NOT NULL DEFAULT FALSE,
  embedding_cache_warm  BOOLEAN NOT NULL DEFAULT FALSE,
  search_tools_fired    BOOLEAN NOT NULL DEFAULT FALSE,
  search_tools_query    VARCHAR(500),
  invoke_tool_fired     BOOLEAN NOT NULL DEFAULT FALSE,
  invoked_tool_name     VARCHAR(120),
  created_at            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS tool_selection_turns_turn_id_key
  ON tool_selection_turns (turn_id);
CREATE INDEX IF NOT EXISTS tool_selection_turns_created_at_idx
  ON tool_selection_turns (created_at);
CREATE INDEX IF NOT EXISTS tool_selection_turns_search_fired_created_idx
  ON tool_selection_turns (search_tools_fired, created_at);

CREATE TABLE IF NOT EXISTS tool_gate_decisions (
  id         TEXT PRIMARY KEY,
  turn_id    TEXT NOT NULL,
  tool_name  VARCHAR(120) NOT NULL,
  verdict    VARCHAR(24) NOT NULL,
  tier       INTEGER,
  rank       INTEGER,
  score      DOUBLE PRECISION,
  reason     VARCHAR(200),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS tool_gate_decisions_turn_id_idx
  ON tool_gate_decisions (turn_id);
CREATE INDEX IF NOT EXISTS tool_gate_decisions_tool_verdict_idx
  ON tool_gate_decisions (tool_name, verdict);
CREATE INDEX IF NOT EXISTS tool_gate_decisions_created_at_idx
  ON tool_gate_decisions (created_at);
