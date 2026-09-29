-- Q-31 · BrainMemory transaction-time validity.
-- OPERATOR-GATED / NOT APPLIED BY THIS PR.
--
-- Why two new columns instead of reusing expires_at:
--   expires_at is already retention/decay TTL. Reusing it would make
--   "what did I believe at t?" depend on garbage-collection policy.
--
-- Why nullable / no backfill:
--   Existing rows fall back to created_at in application queries. A blanket
--   transaction_from_at = created_at backfill would assert a historical
--   system-time fact we did not record. New admitted writes stamp it.
--
-- Apply only after merge + deploy readiness using the protected migration
-- runbook, then read back both columns/indexes before enabling supersession.

ALTER TABLE "brain_memories"
  ADD COLUMN IF NOT EXISTS "transaction_from_at" TIMESTAMP(3);

ALTER TABLE "brain_memories"
  ADD COLUMN IF NOT EXISTS "transaction_expired_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "brain_memories_transaction_from_at_idx"
  ON "brain_memories"("transaction_from_at");

CREATE INDEX IF NOT EXISTS "brain_memories_transaction_expired_at_idx"
  ON "brain_memories"("transaction_expired_at");
