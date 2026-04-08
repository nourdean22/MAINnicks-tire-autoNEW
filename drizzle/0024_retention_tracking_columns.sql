-- Add retention tier tracking to customers table
-- Prevents double-sending the same retention SMS tier to a customer
ALTER TABLE `customers` ADD COLUMN `lastRetentionTier` int DEFAULT NULL;
ALTER TABLE `customers` ADD COLUMN `lastRetentionDate` timestamp DEFAULT NULL;
