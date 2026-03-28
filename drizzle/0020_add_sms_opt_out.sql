-- Add smsOptOut column to customers table for TCPA compliance
ALTER TABLE `customers` ADD COLUMN `smsOptOut` tinyint(1) NOT NULL DEFAULT 0;
