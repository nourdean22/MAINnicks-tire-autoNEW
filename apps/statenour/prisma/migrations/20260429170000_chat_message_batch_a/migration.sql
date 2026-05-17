-- ════════════════════════════════════════════════════════════════════════
-- ChatMessage Batch A · v7.6 · Apr 29
-- ════════════════════════════════════════════════════════════════════════
--
-- 16 columns added to chat_messages + 7 to chat_conversations.
-- All ADD COLUMN IF NOT EXISTS so re-runs are no-ops.
-- Indexes use IF NOT EXISTS for the same reason.
--
-- Closes the entire class of "lost message context on reload" bugs:
--   · Idempotency keys eliminate dup-fire (silent retry / network blip)
--   · `parts` Json retains the FULL UIMessage tree (text + file +
--     reasoning + tool-call + tool-result + source) instead of a flat
--     string. Reload no longer flattens images / reasoning / citations.
--   · `streamingState` lets us resume / badge half-streamed messages.
--   · `parentMessageId` + `branchId` enable regenerate / fork without
--     destroying history.
--   · `editedAt` + `editHistory` make in-place edit safe + reversible.
--   · `provider`/`routerReason`/`latencyMs`/`firstTokenLatencyMs` give
--     observability per-message (perceived-quality metric for 2026).
--   · `costCents`/`promptTokens`/`completionTokens` denormalized from
--     AiGeneration → native cost queries (was JSON-extract scan).
--   · `feedbackScore` per-message ground truth for router learning.
--   · `searchableContent` + GIN index → millisecond chat search
--     (was LIKE scan).
--   · `attachmentsHash` for "this image was uploaded before" dedup.
--
-- Conversation enrichment (7 cols) gives the sidebar archive/star/mute,
-- a denormalized message_count, lastActiveAt for cheap sort, and a
-- pinned_summary that survives the chat shrinker compression.
-- ════════════════════════════════════════════════════════════════════════

-- ── ChatMessage: 16 new columns ──
ALTER TABLE "chat_messages"
  ADD COLUMN IF NOT EXISTS "client_message_id"        VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "parts"                    JSONB,
  ADD COLUMN IF NOT EXISTS "streaming_state"          VARCHAR(16) NOT NULL DEFAULT 'complete',
  ADD COLUMN IF NOT EXISTS "parent_message_id"        VARCHAR,
  ADD COLUMN IF NOT EXISTS "branch_id"                VARCHAR(36),
  ADD COLUMN IF NOT EXISTS "edited_at"                TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "edit_history"             JSONB,
  ADD COLUMN IF NOT EXISTS "error_details"            JSONB,
  ADD COLUMN IF NOT EXISTS "provider"                 VARCHAR(32),
  ADD COLUMN IF NOT EXISTS "router_reason"            VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "latency_ms"               INTEGER,
  ADD COLUMN IF NOT EXISTS "first_token_latency_ms"   INTEGER,
  ADD COLUMN IF NOT EXISTS "cost_cents"               INTEGER,
  ADD COLUMN IF NOT EXISTS "prompt_tokens"            INTEGER,
  ADD COLUMN IF NOT EXISTS "completion_tokens"        INTEGER,
  ADD COLUMN IF NOT EXISTS "feedback_score"           SMALLINT,
  ADD COLUMN IF NOT EXISTS "searchable_content"       TEXT,
  ADD COLUMN IF NOT EXISTS "attachments_hash"         VARCHAR(64);

-- ── ChatConversation: 7 new columns ──
ALTER TABLE "chat_conversations"
  ADD COLUMN IF NOT EXISTS "pinned_summary"  TEXT,
  ADD COLUMN IF NOT EXISTS "topic_tags"      JSONB,
  ADD COLUMN IF NOT EXISTS "archived_at"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "starred_at"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "muted_at"        TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_active_at"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "message_count"   INTEGER NOT NULL DEFAULT 0;

-- ── Indexes ──
-- Idempotency: unique per conversation+client message id (nulls allowed
-- for legacy rows; new writes always carry one).
CREATE UNIQUE INDEX IF NOT EXISTS "chat_messages_conv_client_msg_id_uniq"
  ON "chat_messages"("conversation_id", "client_message_id")
  WHERE "client_message_id" IS NOT NULL;

-- Branching tree walks
CREATE INDEX IF NOT EXISTS "chat_messages_conversation_id_branch_id_idx"
  ON "chat_messages"("conversation_id", "branch_id");
CREATE INDEX IF NOT EXISTS "chat_messages_parent_message_id_idx"
  ON "chat_messages"("parent_message_id");

-- Streaming-state monitoring (find stuck partials, etc.)
CREATE INDEX IF NOT EXISTS "chat_messages_streaming_state_created_at_idx"
  ON "chat_messages"("streaming_state", "created_at");

-- Provider analytics
CREATE INDEX IF NOT EXISTS "chat_messages_provider_created_at_idx"
  ON "chat_messages"("provider", "created_at");

-- Feedback queries
CREATE INDEX IF NOT EXISTS "chat_messages_feedback_score_idx"
  ON "chat_messages"("feedback_score")
  WHERE "feedback_score" IS NOT NULL;

-- Conversation sidebar performance (archived + sort-by-active)
CREATE INDEX IF NOT EXISTS "chat_conversations_archived_at_last_active_at_idx"
  ON "chat_conversations"("archived_at", "last_active_at");
CREATE INDEX IF NOT EXISTS "chat_conversations_starred_at_idx"
  ON "chat_conversations"("starred_at");

-- ── Full-text search index for chat search ──
-- Postgres tsvector + GIN. Generated column auto-updates on every
-- searchable_content write so callers can just write text and get
-- indexed search for free.
ALTER TABLE "chat_messages"
  ADD COLUMN IF NOT EXISTS "searchable_tsv" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', COALESCE("searchable_content", ''))) STORED;

CREATE INDEX IF NOT EXISTS "chat_messages_searchable_tsv_idx"
  ON "chat_messages" USING GIN ("searchable_tsv");

-- ── Foreign key for self-ref branching (Prisma auto-creates this on
-- generate; declared explicitly so migration is reversible without
-- trusting Prisma to figure it out) ──
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chat_messages_parent_message_id_fkey'
  ) THEN
    ALTER TABLE "chat_messages"
      ADD CONSTRAINT "chat_messages_parent_message_id_fkey"
      FOREIGN KEY ("parent_message_id") REFERENCES "chat_messages"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
