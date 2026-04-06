-- Add enrichment columns to customers table
-- These are populated by hourly cron jobs from invoices + work orders

ALTER TABLE `customers` ADD COLUMN IF NOT EXISTS `totalSpent` int NOT NULL DEFAULT 0 AFTER `totalVisits`;
ALTER TABLE `customers` ADD COLUMN IF NOT EXISTS `firstVisitDate` timestamp NULL AFTER `lastVisitDate`;
ALTER TABLE `customers` ADD COLUMN IF NOT EXISTS `vehicleYear` varchar(10) NULL AFTER `balanceDue`;
ALTER TABLE `customers` ADD COLUMN IF NOT EXISTS `vehicleMake` varchar(50) NULL AFTER `vehicleYear`;
ALTER TABLE `customers` ADD COLUMN IF NOT EXISTS `vehicleModel` varchar(50) NULL AFTER `vehicleMake`;

-- Index for spend-based sorting/filtering
CREATE INDEX IF NOT EXISTS `idx_customer_total_spent` ON `customers` (`totalSpent`);
