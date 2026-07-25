-- 2026-07-25 · post_turn_outbox — durable outbox for post-turn chat work.
-- Purely ADDITIVE: one new table + one index. No existing object is
-- touched; pgvector/tsvector extras are unaffected by construction.

CREATE TABLE IF NOT EXISTS "post_turn_outbox" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'deferred-background',
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "post_turn_outbox_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "post_turn_outbox_status_nextAttemptAt_idx"
  ON "post_turn_outbox"("status", "nextAttemptAt");
