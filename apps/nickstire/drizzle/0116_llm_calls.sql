-- 0116: llm_calls — one row per invokeLLM() call (2026-09-01 admin audit, F-21).
--
-- WHY: there was no per-call record of model usage anywhere. Spend, latency and
-- failure rate per lane were unknowable; the only ledger in the system covered
-- reel render spend. Writes come from server/services/llmLedger.ts and are
-- gated behind LLM_LEDGER_ENABLED=true — set that env var only AFTER this file
-- is applied.
--
-- ADDITIVE and IDEMPOTENT (CREATE TABLE IF NOT EXISTS). Status-free by design:
-- `ok` is 0/1, `error` is bounded text, so STRICT_TRANS_TABLES has nothing to
-- reject. Hand-applied.

CREATE TABLE IF NOT EXISTS `llm_calls` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `calledAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `model` VARCHAR(96) NOT NULL,
  `provider` VARCHAR(24) NOT NULL,
  `lane` VARCHAR(64) NOT NULL,
  `promptTokens` INT NULL,
  `completionTokens` INT NULL,
  `latencyMs` INT NOT NULL,
  `ok` TINYINT NOT NULL,
  `error` VARCHAR(200) NULL,
  `hadImages` TINYINT NOT NULL DEFAULT 0,
  INDEX `idx_llm_calls_called` (`calledAt`),
  INDEX `idx_llm_calls_lane` (`lane`, `calledAt`)
);
