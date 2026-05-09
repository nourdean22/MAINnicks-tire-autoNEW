-- Wave-125 — leads pipeline: link callback ↔ lead, surface VAPI calls,
-- attribute leads to bookings/invoices for source-to-revenue analytics.
-- All 4 changes ship together; no dedup or destructive operation.
--
-- IMPACT:
--   1. callbackId FK on leads — closes the "same person in two
--      sections with no link" gap (callback creates duplicate lead row;
--      now they reference each other and dedup is possible)
--   2. bookingId / invoiceId FKs on leads — when a lead becomes a
--      booking or generates an invoice, the FK is set on a hook so
--      "popup leads booked $X this month" becomes a real query
--   3. New vapi_call_logs table — persists every inbound VAPI call
--      with AI summary + service mention so calls that didn't
--      explicitly trigger a callback still appear in the unified
--      intake feed (otherwise they vanish at call-end)
--
-- All ALTER ADD COLUMN are nullable (no backfill required). Operator
-- can apply during read traffic safely.

-- ─── #2 Callback ↔ lead linkage ──────────────────────────────────
ALTER TABLE `leads`
  ADD COLUMN `callbackId` int DEFAULT NULL;
--> statement-breakpoint
ALTER TABLE `leads`
  ADD INDEX `idx_lead_callback_id` (`callbackId`);
--> statement-breakpoint

-- ─── #5 Lead → booking / invoice attribution ─────────────────────
ALTER TABLE `leads`
  ADD COLUMN `bookingId` int DEFAULT NULL;
--> statement-breakpoint
ALTER TABLE `leads`
  ADD COLUMN `invoiceId` int DEFAULT NULL;
--> statement-breakpoint
ALTER TABLE `leads`
  ADD INDEX `idx_lead_booking_id` (`bookingId`);
--> statement-breakpoint
ALTER TABLE `leads`
  ADD INDEX `idx_lead_invoice_id` (`invoiceId`);
--> statement-breakpoint

-- ─── #3 VAPI call logs (NEW table) ───────────────────────────────
-- Persists the AI summary + extracted service mention + customer
-- contact info for every inbound VAPI call. Even calls that didn't
-- result in a callback or booking are tracked here so the operator
-- can review "today's voice calls that mentioned a service".
CREATE TABLE IF NOT EXISTS `vapi_call_logs` (
  `id` int NOT NULL AUTO_INCREMENT,
  `vapiCallId` varchar(64) NOT NULL,
  `phoneNumber` varchar(30),
  `customerName` varchar(255),
  `durationSeconds` int DEFAULT 0,
  `endedReason` varchar(64),
  /** AI-generated 1-2 sentence summary of the call */
  `aiSummary` text,
  /** AI-extracted service mention (brakes, oil change, etc.) */
  `serviceMention` varchar(120),
  /** Whether this call produced a callback / booking / lead row */
  `convertedToLead` int NOT NULL DEFAULT 0,
  `leadId` int DEFAULT NULL,
  `callbackId` int DEFAULT NULL,
  `transcriptUrl` varchar(500),
  `recordingUrl` varchar(500),
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_vapi_call_id` (`vapiCallId`),
  INDEX `idx_vapi_log_created` (`createdAt`),
  INDEX `idx_vapi_log_phone` (`phoneNumber`),
  INDEX `idx_vapi_log_lead` (`leadId`)
);
