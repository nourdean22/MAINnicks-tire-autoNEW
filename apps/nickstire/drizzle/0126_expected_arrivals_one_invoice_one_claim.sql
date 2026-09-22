-- 0126 · One invoice reconciles at most ONE expected arrival, enforced by the DATABASE.
--
-- WHY. reconcileExpectedArrivals() was a single UPDATE ... JOIN invoices with no
-- uniqueness anywhere: every 'expected' row whose phone matched an invoice inside
-- its 3-day window was stamped with that invoice. A customer who said "coming
-- today" on Monday, Tuesday and Wednesday and paid once on Wednesday produced
-- three `arrived` rows sharing one reconciledInvoiceId.
--
-- weeklyRevenueDigest sums i.totalAmount PER ARRIVAL ROW, so that one invoice was
-- added once per claimant in the line the operator reads as revenue. The same
-- shape — eight calls claiming one invoice — was found and fixed on the
-- call->invoice path on 2026-09-18; this is the same defect one table over.
--
-- MEASURED BEFORE FIXING (2026-09-22, read-only, production): 25 arrival rows
-- claim an invoice, 25 distinct invoices, $0.00 overstated. Real in the code,
-- not yet fired — which is why this index applies cleanly today.
--
-- The application now plans one-to-one (server/lib/arrivalReconciliationPlan.ts)
-- and treats a duplicate-key rejection on this index as "already claimed by a
-- concurrent run" rather than as a failed write. NULLs are unlimited under a
-- MySQL/TiDB UNIQUE index, so the many rows with no invoice are unaffected.
--
-- Idempotent: guarded on INFORMATION_SCHEMA.STATISTICS in the 0113 style, so a
-- re-run is a no-op rather than an ER_DUP_KEYNAME.
--
-- Verify, never assume:
--   SHOW INDEX FROM expected_arrivals WHERE Key_name = 'uq_ea_reconciled_invoice';
--
-- Pre-apply check — must return no rows, or the index cannot be created:
--   SELECT reconciledInvoiceId, COUNT(*) n FROM expected_arrivals
--   WHERE reconciledInvoiceId IS NOT NULL GROUP BY reconciledInvoiceId HAVING n > 1;

SET @ea_reconciled_invoice_index = (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE `expected_arrivals` ADD UNIQUE KEY `uq_ea_reconciled_invoice` (`reconciledInvoiceId`)',
    'SELECT 1')
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'expected_arrivals'
    AND INDEX_NAME = 'uq_ea_reconciled_invoice'
);
PREPARE ea_reconciled_invoice_stmt FROM @ea_reconciled_invoice_index;
EXECUTE ea_reconciled_invoice_stmt;
DEALLOCATE PREPARE ea_reconciled_invoice_stmt;
