-- v10.0.194 · ToolTelemetry table extraction from BrainMemory
-- Phase 1: schema only. Dual-write begins immediately. Reads stay
-- on BrainMemory until v10.0.195 cutover.

CREATE TABLE "tool_telemetry" (
  "id" TEXT NOT NULL,
  "tool_name" VARCHAR(120) NOT NULL,
  "total_calls" INTEGER NOT NULL DEFAULT 0,
  "success_count" INTEGER NOT NULL DEFAULT 0,
  "fail_count" INTEGER NOT NULL DEFAULT 0,
  "total_duration_ms" BIGINT NOT NULL DEFAULT 0,
  "last_errors" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "last_call_at" TIMESTAMP(3),
  "failure_rate_pct" DOUBLE PRECISION,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "tool_telemetry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tool_telemetry_tool_name_key" ON "tool_telemetry"("tool_name");
CREATE INDEX "tool_telemetry_total_calls_idx" ON "tool_telemetry"("total_calls" DESC);
CREATE INDEX "tool_telemetry_failure_rate_pct_idx" ON "tool_telemetry"("failure_rate_pct" DESC);
