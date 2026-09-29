-- Q-25 · RealityEvent registry/envelope metadata
--
-- ADDITIVE + OPERATOR-GATED. This file is intentionally parked under
-- migrations-pending. Apply with the repo's normal pending-migration procedure,
-- read back the columns/indexes, then promote/resolve it. No column/table drops.
--
-- Rollback (only after code rollback):
--   DROP INDEX IF EXISTS "reality_events_causation_id_idx";
--   DROP INDEX IF EXISTS "reality_events_correlation_id_idx";
--   DROP INDEX IF EXISTS "reality_events_event_type_occurred_at_idx";
--   ALTER TABLE "reality_events"
--     DROP COLUMN IF EXISTS "retention_class",
--     DROP COLUMN IF EXISTS "causation_id",
--     DROP COLUMN IF EXISTS "correlation_id",
--     DROP COLUMN IF EXISTS "occurred_at",
--     DROP COLUMN IF EXISTS "event_version";

ALTER TABLE "reality_events"
  ADD COLUMN IF NOT EXISTS "event_version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "reality_events"
  ADD COLUMN IF NOT EXISTS "occurred_at" TIMESTAMP(3);

UPDATE "reality_events"
SET "occurred_at" = "observed_at"
WHERE "occurred_at" IS NULL;

ALTER TABLE "reality_events"
  ALTER COLUMN "occurred_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "occurred_at" SET NOT NULL;

ALTER TABLE "reality_events"
  ADD COLUMN IF NOT EXISTS "correlation_id" VARCHAR(160),
  ADD COLUMN IF NOT EXISTS "causation_id" VARCHAR(160),
  ADD COLUMN IF NOT EXISTS "retention_class" VARCHAR(32) NOT NULL DEFAULT 'operational';

-- Backfill existing canonical families so retention truth is useful immediately.
UPDATE "reality_events"
SET "retention_class" = CASE
  WHEN "event_type" = 'experiment.verdict' OR "event_type" LIKE 'proof.%' THEN 'evidence'
  WHEN "event_type" LIKE 'episode.%' THEN 'learning'
  WHEN "event_type" LIKE 'darwin.%' THEN 'audit'
  ELSE 'operational'
END;

CREATE INDEX IF NOT EXISTS "reality_events_event_type_occurred_at_idx"
  ON "reality_events" ("event_type", "occurred_at");

CREATE INDEX IF NOT EXISTS "reality_events_correlation_id_idx"
  ON "reality_events" ("correlation_id");

CREATE INDEX IF NOT EXISTS "reality_events_causation_id_idx"
  ON "reality_events" ("causation_id");
