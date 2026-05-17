-- Booking confirmation tracking: Booking → Confirm pipeline stage
-- Tracks when/how a customer confirmed their visit

ALTER TABLE `bookings` ADD COLUMN `confirmedAt` timestamp NULL;
ALTER TABLE `bookings` ADD COLUMN `confirmationMethod` varchar(20) NULL;
ALTER TABLE `bookings` ADD COLUMN `confirmationSentAt` timestamp NULL;
