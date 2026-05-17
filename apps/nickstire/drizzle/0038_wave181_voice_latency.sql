-- wave-181.4 · voice_latency_events table · VAPI migration from statenour-os
--
-- Origin: statenour-os v10.0.527 Arc A F3 (voice latency capture).
-- Migrated to nickstire per the business-separation directive — VAPI is
-- shop infrastructure, belongs on nickstire.
--
-- Per-VAPI-call STT/LLM/TTS/end-to-end latency telemetry. Drives the
-- /admin observability tile + Telegram alert when 3 consecutive
-- call-days exceed the p50 target (500ms).
--
-- FAIL-OPEN at the application layer: server/services/voice-latency.ts
-- catches every write so an un-applied migration never breaks a VAPI
-- webhook in production. This SQL is safe to apply at any time.
--
-- ROLLBACK: DROP TABLE IF EXISTS voice_latency_events;

CREATE TABLE IF NOT EXISTS voice_latency_events (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  call_id VARCHAR(64) NOT NULL,
  assistant_id VARCHAR(64) NOT NULL,
  stage VARCHAR(32) NOT NULL,
  latency_ms INT NOT NULL,
  metadata JSON DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX voice_latency_events_call_stage_idx (call_id, stage),
  INDEX voice_latency_events_created_at_idx (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
