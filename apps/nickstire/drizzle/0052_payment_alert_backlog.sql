-- 2026-05-23 · payment_alert_backlog
--
-- Surfaces paid tire orders where BOTH the shop hand-off email AND
-- the operator Telegram alert failed. Pre-fix, a Resend outage +
-- Telegram outage at the same time meant a paid order sat in the DB
-- as `paid` but nobody knew to fulfil it. Now we write a row to this
-- table so the admin can surface a banner ("N paid orders need manual
-- shop hand-off") on the Today dashboard.
--
-- Apply by hand: `mysql ... < drizzle/0052_payment_alert_backlog.sql`
-- (nickstire convention · no auto-migrate).

CREATE TABLE IF NOT EXISTS `payment_alert_backlog` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  -- The tire order or invoice that's stuck waiting for manual hand-off.
  -- Only one of these is populated per row depending on payment source.
  `tireOrderNumber` VARCHAR(64) DEFAULT NULL,
  `invoiceNumber` VARCHAR(64) DEFAULT NULL,
  -- Cents · so the operator can verify the paid amount at a glance.
  `amountCents` INT NOT NULL,
  -- Brief context for the operator. Surfaced in the admin banner.
  `summary` VARCHAR(500) NOT NULL,
  -- Why we wrote this row. "email_failed" · "telegram_failed" ·
  -- "both_failed" — the last is the most-urgent.
  `failureReason` ENUM('email_failed', 'telegram_failed', 'both_failed') NOT NULL,
  -- Operator marks resolved when they've manually fulfilled the order.
  `resolvedAt` TIMESTAMP NULL DEFAULT NULL,
  `resolvedBy` VARCHAR(255) DEFAULT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_payment_alert_backlog_unresolved` (`resolvedAt`, `createdAt` DESC),
  INDEX `idx_payment_alert_backlog_tire_order` (`tireOrderNumber`),
  INDEX `idx_payment_alert_backlog_invoice` (`invoiceNumber`)
);
