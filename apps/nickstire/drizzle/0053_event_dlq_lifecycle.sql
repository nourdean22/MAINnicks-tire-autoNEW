-- 2026-05-23 · event_dlq + lifecycle_tracker_events
--
-- Two tables, one migration to minimize operator hand-apply work.
-- Both replace in-memory state in eventBus.ts that didn't survive
-- Railway pod restart and couldn't share across multi-pod deploys.
--
-- Apply by hand: `mysql ... < drizzle/0053_event_dlq_lifecycle.sql`

-- ─── event_dlq ─────────────────────────────────────────────
--
-- Pre-fix · failed subscribers landed in a 50-item in-memory array
-- (deadLetterQueue) cleared on every restart. A subscriber failing
-- silently across restarts was invisible to the operator.
-- Now · failures are persisted with eventType + destination + error
-- + payload. A periodic check can alert via Telegram when the same
-- (eventType, destination) pair fails ≥3 times in 10 minutes.

CREATE TABLE IF NOT EXISTS `event_dlq` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  -- Business event name (e.g. "lead_captured", "invoice_paid")
  `eventType` VARCHAR(64) NOT NULL,
  -- Destination subscriber name (e.g. "telegram", "nour-os", "realtime-push")
  `destination` VARCHAR(64) NOT NULL,
  -- Error message (truncated to 500 chars)
  `error` VARCHAR(500) NOT NULL,
  -- Original event payload at time of failure
  `payload` JSON,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Set when an alert has been fired for this failure pattern so we
  -- don't spam Telegram with the same alert.
  `alertedAt` TIMESTAMP NULL DEFAULT NULL,
  -- Rolling-window failure-rate check
  INDEX `idx_event_dlq_pattern` (`eventType`, `destination`, `createdAt` DESC),
  -- Unalerted scan
  INDEX `idx_event_dlq_alerted` (`alertedAt`, `createdAt` DESC)
);

-- ─── lifecycle_tracker_events ───────────────────────────────
--
-- Pre-fix · in-memory Map<phone10, events[]> aggregated lead → contact
-- → booking → payment events to write a "FULL CONVERSION" Nick memory
-- once the journey closed. Map is process-local · on a multi-pod
-- Railway deploy, lead and payment land on different pods, the journey
-- never completes, and the supervised-signal-loop loses half its
-- training data.
-- Now · UPSERT-keyed-by-phone10 means any pod can extend the journey.
-- Cron (or the next event arrival) checks for completion and writes
-- the memory.

CREATE TABLE IF NOT EXISTS `lifecycle_tracker_events` (
  `phone10` VARCHAR(10) PRIMARY KEY,
  -- Best-effort customer name captured at journey start (used in the
  -- conversion memory text)
  `customerName` VARCHAR(255) DEFAULT NULL,
  -- JSON array of {type: string, at: epochMs}
  `events` JSON NOT NULL,
  -- Stamped when "FULL CONVERSION" memory was written for this journey;
  -- prevents duplicate memory writes if more events land later.
  `convertedAt` TIMESTAMP NULL DEFAULT NULL,
  `firstSeenAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `lastSeenAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Dashboard query: most-recently-active journeys
  INDEX `idx_lifecycle_last_seen` (`lastSeenAt` DESC),
  -- Conversion scan: incomplete journeys eligible for win-back
  INDEX `idx_lifecycle_unconverted` (`convertedAt`, `lastSeenAt` DESC)
);
