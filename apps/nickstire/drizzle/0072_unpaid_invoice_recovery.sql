-- 2026-06-20 · drizzle/0072_unpaid_invoice_recovery.sql
--
-- Adds at-most-once claim + sent markers to `invoices` for the unpaid-invoice
-- recovery SMS cron (env flag FEATURE_UNPAID_INVOICE_RECOVERY). camelCase
-- column names match this table's existing convention (customerId,
-- totalAmount, paymentStatus, invoiceDate, ...) — NOT the snake_case used by
-- alg_estimates. Additive only, no destructive changes. Idempotent on TiDB
-- via ADD COLUMN IF NOT EXISTS.
--
-- HAND-APPLY to prod TiDB, then run `pnpm run check`. Nothing auto-migrates on
-- deploy. The cron stays dry-run (sends nothing) until BOTH this migration is
-- applied AND FEATURE_UNPAID_INVOICE_RECOVERY=1 is set on Railway.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paymentReminder7dAttemptedAt  TIMESTAMP NULL DEFAULT NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paymentReminder7dSentAt       TIMESTAMP NULL DEFAULT NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paymentReminder30dAttemptedAt TIMESTAMP NULL DEFAULT NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paymentReminder30dSentAt      TIMESTAMP NULL DEFAULT NULL;
