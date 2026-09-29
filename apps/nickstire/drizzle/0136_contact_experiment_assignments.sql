-- 0135 · Customer-contact holdout assignments
--
-- One durable assignment per experiment + customer subject. This is the
-- no-contact control spine for Q-21; it is deliberately separate from
-- sms_orchestrations.is_control, which means copy/template control, not
-- "withhold the contact".
--
-- All rollout switches default OFF. The table being present changes no
-- customer behavior by itself.

CREATE TABLE IF NOT EXISTS contact_experiment_assignments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  experiment_id VARCHAR(120) NOT NULL,
  lane_key VARCHAR(100) NOT NULL,
  subject_key VARCHAR(64) NOT NULL,
  arm_id VARCHAR(16) NOT NULL,
  assignment_version VARCHAR(32) NOT NULL,
  source_variant_key VARCHAR(100) NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_contact_exp_subject (experiment_id, subject_key),
  KEY idx_contact_exp_lane_arm_time (lane_key, arm_id, assigned_at),
  KEY idx_contact_exp_assigned (assigned_at)
);

-- Legacy lane state machines claimed rows as "sent" before provider dispatch
-- to guarantee at-most-once behavior. A no-contact control is also terminal,
-- but calling it sent or failed would corrupt the operator readout. Extend the
-- enums so the source lane can represent the truth after the holdout decision.
ALTER TABLE winback_sends
  MODIFY COLUMN status ENUM('pending','sent','heldout','failed') NOT NULL DEFAULT 'pending';

ALTER TABLE sms_campaign_sends
  MODIFY COLUMN status ENUM('pending','sent','heldout','failed') NOT NULL DEFAULT 'pending';

ALTER TABLE review_requests
  MODIFY COLUMN status ENUM('pending','sent','clicked','heldout','failed','skipped') NOT NULL DEFAULT 'pending';
