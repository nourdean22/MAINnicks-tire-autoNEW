-- Wave-100 — materialize declined-work + active-backlog totals per customer
-- so the customers.list query stops running 4 correlated subqueries per row.

ALTER TABLE `customer_metrics` ADD COLUMN `declinedValue` int NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `customer_metrics` ADD COLUMN `declinedCount` int NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `customer_metrics` ADD COLUMN `backlogValueCents` int NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `customer_metrics` ADD COLUMN `backlogCount` int NOT NULL DEFAULT 0;
