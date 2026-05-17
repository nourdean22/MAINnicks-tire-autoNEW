-- v8.0 · Apr 29 · Phase 2A — Universal entity-audit trail
-- ============================================================
-- Generic provenance log: one row per meaningful mutation across
-- the system. Composed on top of v7.8 (actor) + v7.9 (soft-delete)
-- to answer "who did what and when" queries.
--
-- Distinct from per-entity event logs (task_events, goal_events):
--   · TaskEvent / GoalEvent — domain-semantic events (created,
--     started, snoozed, priority_changed) for the brain pattern miner.
--   · EntityAudit            — field-level diffs (title: 'A' → 'B')
--     for "show me everything that changed" queries.
--
-- Indexes are tuned for the four hot read patterns:
--   1. (entityType, entityId, createdAt DESC) — "history of this row"
--   2. (actor, createdAt DESC)                — "what did Nick do?"
--   3. (action, createdAt DESC)               — "what got soft-deleted today?"
--   4. (createdAt DESC)                       — global firehose / dashboard
-- ============================================================

CREATE TABLE IF NOT EXISTS "entity_audits" (
  "id"              TEXT          NOT NULL,
  "entity_type"     VARCHAR(64)   NOT NULL,
  "entity_id"       TEXT          NOT NULL,
  "action"          VARCHAR(32)   NOT NULL,
  "actor"           VARCHAR(64)   NOT NULL,
  "before"          JSONB,
  "after"           JSONB,
  "reason"          TEXT,
  "source"          TEXT,
  "idempotency_key" VARCHAR(64),
  "created_at"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "entity_audits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "entity_audits_entity_type_entity_id_created_at_idx"
  ON "entity_audits"("entity_type", "entity_id", "created_at");

CREATE INDEX IF NOT EXISTS "entity_audits_actor_created_at_idx"
  ON "entity_audits"("actor", "created_at");

CREATE INDEX IF NOT EXISTS "entity_audits_action_created_at_idx"
  ON "entity_audits"("action", "created_at");

CREATE INDEX IF NOT EXISTS "entity_audits_created_at_idx"
  ON "entity_audits"("created_at");

-- Idempotency-key unique partial: like v7.7, only enforce uniqueness
-- when a key is present. Legacy NULL rows don't conflict.
CREATE UNIQUE INDEX IF NOT EXISTS "entity_audits_idempotency_key_uniq"
  ON "entity_audits"("idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
