-- Durable audit for the agent bridge (BridgeCallLog). Additive, non-destructive.
-- Idempotent: safe to re-run. Touches nothing pgvector/tsvector.
CREATE TABLE IF NOT EXISTS "bridge_call_logs" (
  "id"            TEXT PRIMARY KEY,
  "request_id"    TEXT NOT NULL,
  "protocol"      TEXT NOT NULL,
  "client_id"     TEXT NOT NULL,
  "scope"         TEXT NOT NULL,
  "tool_name"     TEXT NOT NULL,
  "external_name" TEXT NOT NULL,
  "status"        TEXT NOT NULL,
  "risk_class"    TEXT NOT NULL,
  "latency_ms"    INTEGER NOT NULL,
  "input_hash"    TEXT NOT NULL,
  "result_size"   INTEGER,
  "error_code"    TEXT,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "bridge_call_logs_tool_name_idx"  ON "bridge_call_logs"("tool_name");
CREATE INDEX IF NOT EXISTS "bridge_call_logs_client_id_idx"  ON "bridge_call_logs"("client_id");
CREATE INDEX IF NOT EXISTS "bridge_call_logs_created_at_idx" ON "bridge_call_logs"("created_at");
