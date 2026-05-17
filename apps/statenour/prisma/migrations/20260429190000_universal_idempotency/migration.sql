-- ════════════════════════════════════════════════════════════════════════
-- Universal Idempotency · v7.7 · Apr 29
-- ════════════════════════════════════════════════════════════════════════
--
-- Phase 1 of the schema-audit hardening: extend the idempotency-key
-- pattern (already on chat_messages.client_message_id from Batch A) to
-- the agent + event-log layer.
--
-- Six tables get a nullable `idempotency_key VARCHAR(64)` + a UNIQUE
-- PARTIAL INDEX `WHERE idempotency_key IS NOT NULL`. The partial
-- aspect is the magic: legacy NULL rows don't conflict, but every
-- non-NULL key is unique system-wide.
--
-- Tables touched (highest-leverage agent + event paths):
--   1. autonomous_actions  — agent mutation log (#1 priority)
--   2. scheduled_actions   — scheduled trigger queue
--   3. task_events         — append-only Task event log
--   4. goal_events         — append-only Goal event log
--   5. reflections         — daily/weekly/monthly cron output
--   6. decision_replays    — 30/60/90-day decision review
--
-- All ADD COLUMN IF NOT EXISTS + CREATE UNIQUE INDEX IF NOT EXISTS
-- so re-runs are no-ops + the migration is reversible (DROP COLUMN +
-- DROP INDEX, no data lost beyond the keys themselves).
-- ════════════════════════════════════════════════════════════════════════

-- 1. autonomous_actions
ALTER TABLE "autonomous_actions"
  ADD COLUMN IF NOT EXISTS "idempotency_key" VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS "autonomous_actions_idempotency_key_uniq"
  ON "autonomous_actions"("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

-- 2. scheduled_actions
ALTER TABLE "scheduled_actions"
  ADD COLUMN IF NOT EXISTS "idempotency_key" VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS "scheduled_actions_idempotency_key_uniq"
  ON "scheduled_actions"("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

-- 3. task_events
ALTER TABLE "task_events"
  ADD COLUMN IF NOT EXISTS "idempotency_key" VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS "task_events_idempotency_key_uniq"
  ON "task_events"("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

-- 4. goal_events
ALTER TABLE "goal_events"
  ADD COLUMN IF NOT EXISTS "idempotency_key" VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS "goal_events_idempotency_key_uniq"
  ON "goal_events"("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

-- 5. reflections
ALTER TABLE "reflections"
  ADD COLUMN IF NOT EXISTS "idempotency_key" VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS "reflections_idempotency_key_uniq"
  ON "reflections"("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;

-- 6. decision_replays
ALTER TABLE "decision_replays"
  ADD COLUMN IF NOT EXISTS "idempotency_key" VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS "decision_replays_idempotency_key_uniq"
  ON "decision_replays"("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
