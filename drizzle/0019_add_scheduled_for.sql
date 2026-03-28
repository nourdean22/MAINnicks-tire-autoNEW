-- Add scheduled_for column to appointment_reminders
-- This column tracks when each reminder should fire, enabling time-based scheduling
ALTER TABLE `appointment_reminders` ADD COLUMN `scheduled_for` timestamp NULL AFTER `type`;
