-- expected_arrivals — a durable "the customer said they're coming / dropping off"
-- record (NCSOS business-action-tools).
--
-- The shop is first-come-first-served and drop-off-preferred, so a voice/SMS
-- "I'll come by today" must NOT create a booking (operator directive 2026-06-05)
-- or a lead (sms-no-lead-noise) — but it IS a real operational signal the shop can
-- plan around and later reconcile to an arrival / paid invoice. Before this,
-- bookSlot/scheduleDropoff persisted nothing and agenticAuditor flagged "dropoff
-- promised but not persisted". See server/services/expectedArrivals.ts. This
-- mirrors the handleRunMigrations inline DDL; the two must stay identical.

CREATE TABLE IF NOT EXISTS `expected_arrivals` (
  `id` int AUTO_INCREMENT NOT NULL,
  `customerName` varchar(255) NULL,
  `customerPhone` varchar(30) NOT NULL,
  `vehicle` varchar(255) NULL,
  `service` varchar(255) NULL,
  `expectedDate` date NOT NULL,
  `whenText` varchar(100) NULL,
  `source` enum('voice','sms','web','manual') NOT NULL DEFAULT 'manual',
  `sourceRef` varchar(128) NULL,
  `status` enum('expected','arrived','no_show','cancelled') NOT NULL DEFAULT 'expected',
  `arrivedAt` timestamp NULL,
  `reconciledInvoiceId` int NULL,
  `note` varchar(500) NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `expected_arrivals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_ea_status_date` ON `expected_arrivals` (`status`,`expectedDate`);
--> statement-breakpoint
CREATE INDEX `idx_ea_phone` ON `expected_arrivals` (`customerPhone`);
