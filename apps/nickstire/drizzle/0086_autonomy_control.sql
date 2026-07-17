-- Autonomy control plane (Wave A): versioned policy + append-only audit trail.
-- The runner can mark migrations tracked without executing them (0083/0084/0085
-- all hit that) — hand-apply via scripts/apply-0086-autonomy-control.mts.
CREATE TABLE `autonomy_policy_versions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `version` int NOT NULL,
  `policy_json` text NOT NULL,
  `note` varchar(400) NOT NULL DEFAULT '',
  `created_by` varchar(120) NOT NULL DEFAULT 'operator',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `autonomy_policy_versions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `autonomy_audit_events` (
  `id` varchar(64) NOT NULL,
  `occurred_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `action_type` varchar(48) NOT NULL,
  `decision` varchar(24) NOT NULL,
  `reasoning_codes` varchar(1024) NOT NULL,
  `policy_version` int NOT NULL,
  `context_json` text,
  `campaign_id` varchar(64),
  CONSTRAINT `autonomy_audit_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_autonomy_audit_occurred` ON `autonomy_audit_events` (`occurred_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_autonomy_policy_version` ON `autonomy_policy_versions` (`version`);
--> statement-breakpoint
CREATE TABLE `generation_reservations` (
  `id` varchar(64) NOT NULL,
  `action_id` varchar(64) NOT NULL,
  `campaign_id` varchar(64),
  `provider` varchar(48) NOT NULL,
  `model` varchar(64) NOT NULL,
  `operation` varchar(48) NOT NULL,
  `estimated_cost_usd` decimal(10,4) NOT NULL,
  `actual_cost_usd` decimal(10,4),
  `is_estimate` boolean NOT NULL DEFAULT true,
  `status` varchar(16) NOT NULL DEFAULT 'reserved',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `settled_at` timestamp NULL,
  CONSTRAINT `generation_reservations_id` PRIMARY KEY(`id`),
  CONSTRAINT `uq_generation_reservations_action` UNIQUE(`action_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_generation_reservations_created` ON `generation_reservations` (`created_at`);
