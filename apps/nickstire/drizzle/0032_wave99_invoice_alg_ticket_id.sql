-- Wave-99 — capture ALG ticket UUID in invoices for stable cross-system
-- linking. Previously the invoiceNumber was the only key, but it can
-- collide with manually-created invoices and doesn't survive ALG
-- ticket deletes/refunds.

ALTER TABLE `invoices` ADD COLUMN `algTicketId` varchar(64);
--> statement-breakpoint
CREATE INDEX `idx_invoice_alg_ticket` ON `invoices` (`algTicketId`);
