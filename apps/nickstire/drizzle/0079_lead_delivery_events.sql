-- 2026-07-12 · drizzle/0079_lead_delivery_events.sql
--
-- Durable per-lead notification delivery ledger. lead.ts fires email / SMS /
-- Telegram fire-and-forget; today only FAILURES persist (integration_failures),
-- so after a restart there is no record that a notification was even ATTEMPTED
-- or SENT — "did the CEO email for this lead go out?" is unanswerable. This
-- table appends one row per dispatch attempt+outcome per lead. Failures still
-- also land in integration_failures (unchanged); this is the superset.
--
-- `leadId` is INT (matches leads.id INT AUTO_INCREMENT) and NULLABLE — an early
-- failure can fire before the lead row id is known. NO foreign key: an
-- append-only audit trail must survive lead deletion (removing a lead must not
-- erase the record that we tried to reach them).
--
-- "sent" = our dispatch call resolved without throwing, NOT a carrier delivery
-- receipt. Carrier-confirmed delivery needs Resend/Twilio webhooks — a later
-- enhancement; the `delivered` status value is reserved for it.
--
-- ⚠️ OPERATOR-APPLIED (railway-run pattern, per nickstire migration rules).
--    NEVER auto-apply. Pure CREATE TABLE, no backfill — recording starts from
--    the first notification after deploy. Ships with PR code; apply at deploy
--    so the INSERTs (already wrapped in try/catch, non-blocking) find the table.

CREATE TABLE `lead_delivery_events` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `leadId` INT NULL,
  `channel` ENUM('email','sms','telegram','capi','push') NOT NULL,
  `status` ENUM('attempted','sent','queued','delivered','failed','skipped') NOT NULL,
  `provider` VARCHAR(40) NULL,
  `providerRef` VARCHAR(191) NULL,
  `detail` TEXT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_lde_lead` (`leadId`, `createdAt`)
);
