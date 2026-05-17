-- v10.0.198 · AutonomousEvent table extraction from BrainMemory
CREATE TABLE "autonomous_events" (
  "id" TEXT NOT NULL,
  "event_id" VARCHAR(80) NOT NULL,
  "rule_name" VARCHAR(120) NOT NULL,
  "action_type" VARCHAR(80),
  "target_type" VARCHAR(80),
  "target_id" TEXT,
  "result" VARCHAR(40) NOT NULL,
  "error_message" TEXT,
  "worker" VARCHAR(80),
  "fired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "autonomous_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "autonomous_events_event_id_key" ON "autonomous_events"("event_id");
CREATE INDEX "autonomous_events_rule_name_fired_at_idx" ON "autonomous_events"("rule_name", "fired_at" DESC);
CREATE INDEX "autonomous_events_result_fired_at_idx" ON "autonomous_events"("result", "fired_at" DESC);
CREATE INDEX "autonomous_events_fired_at_idx" ON "autonomous_events"("fired_at" DESC);
