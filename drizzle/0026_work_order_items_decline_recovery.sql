-- Declined work line recovery tracking (outreach while declined + recovered timestamp)
ALTER TABLE `work_order_items`
  ADD COLUMN `decline_outreach_at` timestamp NULL AFTER `decline_reason`,
  ADD COLUMN `decline_outreach_method` varchar(64) NULL AFTER `decline_outreach_at`,
  ADD COLUMN `decline_outreach_notes` text NULL AFTER `decline_outreach_method`,
  ADD COLUMN `decline_recovered_at` timestamp NULL AFTER `decline_outreach_notes`;
