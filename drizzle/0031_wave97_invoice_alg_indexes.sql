-- Wave-97 indexes — fix unindexed scans in admin reporting queries
-- Audited 2026-05-07 · subqueries on customers.list (declined/backlog
-- aggregates) were doing full-table scans on alg_estimates.customer_phone
-- and work_orders.customer_id without supporting indexes on the FK side.
-- Also adds the missing composite for the most-common dashboard query
-- (last-N paid revenue) which was hitting two single-column indexes.

CREATE INDEX `idx_invoice_customer_id` ON `invoices` (`customerId`);
--> statement-breakpoint
CREATE INDEX `idx_invoice_customer_phone` ON `invoices` (`customerPhone`);
--> statement-breakpoint
CREATE INDEX `idx_invoice_source` ON `invoices` (`source`);
--> statement-breakpoint
CREATE INDEX `idx_invoice_date_status` ON `invoices` (`invoiceDate`,`paymentStatus`);
--> statement-breakpoint
CREATE INDEX `idx_alg_est_customer_name` ON `alg_estimates` (`customer_name`);
--> statement-breakpoint
CREATE INDEX `idx_alg_est_source` ON `alg_estimates` (`source`);
