-- H1 · 2026-07-28 late · Apple Health ingestion (blueprint health batch).
-- Two NEW tables, fully additive, idempotent via IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS "health_samples" (
    "id" TEXT NOT NULL,
    "source_system" TEXT NOT NULL DEFAULT 'apple_health',
    "source_sample_id" TEXT NOT NULL,
    "metric_type" TEXT NOT NULL,
    "start_at" TIMESTAMP(3) NOT NULL,
    "end_at" TIMESTAMP(3) NOT NULL,
    "numeric_value" DOUBLE PRECISION,
    "unit" TEXT,
    "category_value" TEXT,
    "source_name" TEXT,
    "source_bundle_id" TEXT,
    "metadata" JSONB,
    "batch_id" TEXT NOT NULL,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "health_samples_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "health_samples_source_system_source_sample_id_key"
  ON "health_samples"("source_system", "source_sample_id");
CREATE INDEX IF NOT EXISTS "health_samples_metric_type_start_at_idx"
  ON "health_samples"("metric_type", "start_at");
CREATE INDEX IF NOT EXISTS "health_samples_batch_id_idx"
  ON "health_samples"("batch_id");

CREATE TABLE IF NOT EXISTS "health_ingest_batches" (
    "id" TEXT NOT NULL,
    "inlet" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accepted" INTEGER NOT NULL,
    "deduplicated" INTEGER NOT NULL,
    "rejected" INTEGER NOT NULL,
    "summarized" JSONB,
    "committed_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "health_ingest_batches_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "health_ingest_batches_received_at_idx"
  ON "health_ingest_batches"("received_at");
