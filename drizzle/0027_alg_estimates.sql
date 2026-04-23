-- ─── alg_estimates — ALG walk-in estimates / declined work ───
-- Pure additive migration. CREATE TABLE is non-destructive: existing
-- queries continue working, new table starts empty until runEstimateMirror
-- populates it.

CREATE TABLE IF NOT EXISTS `alg_estimates` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `external_id` VARCHAR(64) NOT NULL,
  `customer_name` VARCHAR(255) NOT NULL,
  `customer_phone` VARCHAR(30) NULL,
  `vehicle_info` VARCHAR(255) NULL,
  `service_description` TEXT NULL,
  `estimated_amount` INT NOT NULL DEFAULT 0,
  `estimate_date` TIMESTAMP NOT NULL,
  `matched_invoice_id` INT NULL,
  `matched_at` TIMESTAMP NULL,
  `follow_up_7d_sent` INT NOT NULL DEFAULT 0,
  `follow_up_7d_sent_at` TIMESTAMP NULL,
  `follow_up_30d_sent` INT NOT NULL DEFAULT 0,
  `follow_up_30d_sent_at` TIMESTAMP NULL,
  `recovery_note` TEXT NULL,
  `source` VARCHAR(32) NOT NULL DEFAULT 'alg',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `alg_estimates_external_id_unique` (`external_id`),
  KEY `idx_alg_est_phone` (`customer_phone`),
  KEY `idx_alg_est_date` (`estimate_date`),
  KEY `idx_alg_est_unmatched` (`matched_invoice_id`, `estimate_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
