-- v10.0.529.106 · Wave 61 · cross-lambda trace propagation.
--
-- Pre-Wave-61 the AgentTrace chain broke whenever a chat request
-- triggered an autonomous cron action in a different lambda
-- invocation. Producers can now attach the originating traceId when
-- they emit a BrainBusEvent; consumers read it back when they
-- process so /system/agent-traces can show the full chain across
-- lambda boundaries.

ALTER TABLE "brain_bus_events"
  ADD COLUMN "trace_id" TEXT;

CREATE INDEX "brain_bus_events_trace_id_idx"
  ON "brain_bus_events" ("trace_id");
