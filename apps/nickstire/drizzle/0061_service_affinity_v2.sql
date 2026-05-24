-- wave-181.x Service Affinity v2 · Wave 1 · schema
-- Per docs/2026-05-24-service-affinity-v2.md §2.3 (CLOSED LOOP layer).
-- 4 new tables · predictions / impressions / actions / outcomes.
-- Hand-applied per CLAUDE.md "Migrations are hand-applied SQL".

-- 1 · service_affinity_predictions
-- Every prediction the v2 cron computes · who · what · how confident · why
CREATE TABLE IF NOT EXISTS `service_affinity_predictions` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `customer_id` BIGINT NOT NULL,
  `predicted_service` VARCHAR(64) NOT NULL,
  `confidence` DECIMAL(5,4) NOT NULL,
  `features_json` JSON NOT NULL,
  `model_version` VARCHAR(32) NOT NULL,
  `ab_arm` ENUM('treatment', 'control') NOT NULL DEFAULT 'treatment',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_customer_created` (`customer_id`, `created_at` DESC),
  INDEX `idx_model_created` (`model_version`, `created_at`),
  INDEX `idx_ab_arm_created` (`ab_arm`, `created_at`)
) ENGINE=InnoDB;

-- 2 · prediction_impressions
-- When the prediction was actually shown to the operator (impression log)
CREATE TABLE IF NOT EXISTS `prediction_impressions` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `prediction_id` BIGINT NOT NULL,
  `shown_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `surface` VARCHAR(64) NOT NULL,
  `operator_id` VARCHAR(64) NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_prediction_shown` (`prediction_id`, `shown_at`)
) ENGINE=InnoDB;

-- 3 · prediction_actions
-- Operator action (or inaction) on the prediction
CREATE TABLE IF NOT EXISTS `prediction_actions` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `prediction_id` BIGINT NOT NULL,
  `action` VARCHAR(32) NOT NULL,
  `acted_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `operator_id` VARCHAR(64) NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_prediction_acted` (`prediction_id`, `acted_at`),
  INDEX `idx_action_acted` (`action`, `acted_at`)
) ENGINE=InnoDB;

-- 4 · prediction_outcomes
-- Did the prediction pan out · linked to invoice if booked
CREATE TABLE IF NOT EXISTS `prediction_outcomes` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `prediction_id` BIGINT NOT NULL,
  `invoice_id` BIGINT NULL,
  `matched` TINYINT(1) NOT NULL,
  `resolved_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `window_days` INT NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_prediction` (`prediction_id`),
  INDEX `idx_resolved` (`resolved_at`)
) ENGINE=InnoDB;

-- ACTIONS LOG ENUM (for reference · enforced at app layer not DB)
-- action: 'sms_sent' | 'dismissed' | 'snoozed' | 'called' | 'modified'
--
-- SURFACE ENUM (for reference · enforced at app layer)
-- surface: 'admin_roster' | 'customer_drawer' | 'sms_queue' | 'statenour_brain'
