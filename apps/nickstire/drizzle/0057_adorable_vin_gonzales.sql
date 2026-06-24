CREATE TABLE `nickgpt_training_examples` (
	`id` int AUTO_INCREMENT NOT NULL,
	`customer_phone` varchar(30) NOT NULL,
	`inbound_message` text NOT NULL,
	`conversation_context_json` text,
	`nickgpt_draft` text NOT NULL,
	`operator_final_reply` text NOT NULL,
	`intent` varchar(100),
	`service_mention` varchar(100),
	`rating` int,
	`outcome` varchar(100),
	`approved_for_training` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `nickgpt_training_examples_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sms_learning_recommendations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`recommendation_type` varchar(100) NOT NULL,
	`event_type` varchar(100) NOT NULL,
	`current_variant_key` varchar(100) NOT NULL,
	`proposed_variant_key` varchar(100) NOT NULL,
	`proposed_message` text NOT NULL,
	`reason` text NOT NULL,
	`supporting_stats_json` text,
	`status` varchar(50) NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`reviewed_at` timestamp,
	`reviewed_by` varchar(100),
	CONSTRAINT `sms_learning_recommendations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sms_orchestration_outcomes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`orchestration_id` int NOT NULL,
	`outcome_type` varchar(100) NOT NULL,
	`outcome_value` text,
	`source_table` varchar(100),
	`source_id` varchar(100),
	`metadata_json` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sms_orchestration_outcomes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `sms_orchestrations` ADD `status_reason` text;--> statement-breakpoint
ALTER TABLE `sms_orchestrations` ADD `delivery_status` varchar(50);--> statement-breakpoint
ALTER TABLE `sms_orchestrations` ADD `delivered_at` timestamp;--> statement-breakpoint
ALTER TABLE `sms_orchestrations` ADD `replied_at` timestamp;--> statement-breakpoint
ALTER TABLE `sms_orchestrations` ADD `failed_at` timestamp;--> statement-breakpoint
ALTER TABLE `sms_orchestrations` ADD `sent_at` timestamp;--> statement-breakpoint
ALTER TABLE `sms_orchestrations` ADD `queued_until` timestamp;--> statement-breakpoint
ALTER TABLE `sms_orchestrations` ADD `failure_reason` text;--> statement-breakpoint
ALTER TABLE `sms_orchestrations` ADD `source_table` varchar(100);--> statement-breakpoint
ALTER TABLE `sms_orchestrations` ADD `source_id` varchar(100);--> statement-breakpoint
ALTER TABLE `sms_orchestrations` ADD `related_conversation_id` int;--> statement-breakpoint
ALTER TABLE `sms_orchestrations` ADD `related_lead_id` int;--> statement-breakpoint
ALTER TABLE `sms_orchestrations` ADD `related_booking_id` int;--> statement-breakpoint
ALTER TABLE `sms_orchestrations` ADD `related_callback_id` int;--> statement-breakpoint
ALTER TABLE `sms_orchestrations` ADD `related_vapi_call_id` varchar(100);--> statement-breakpoint
ALTER TABLE `sms_orchestrations` ADD `related_estimate_id` varchar(100);--> statement-breakpoint
ALTER TABLE `sms_orchestrations` ADD `send_result_json` text;--> statement-breakpoint
ALTER TABLE `sms_orchestrations` ADD `metadata_json` text;--> statement-breakpoint
CREATE INDEX `idx_ngpt_train_phone` ON `nickgpt_training_examples` (`customer_phone`);--> statement-breakpoint
CREATE INDEX `idx_ngpt_train_created` ON `nickgpt_training_examples` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_sms_rec_type` ON `sms_learning_recommendations` (`recommendation_type`);--> statement-breakpoint
CREATE INDEX `idx_sms_rec_status` ON `sms_learning_recommendations` (`status`);--> statement-breakpoint
CREATE INDEX `idx_sms_rec_created` ON `sms_learning_recommendations` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_sms_out_orch` ON `sms_orchestration_outcomes` (`orchestration_id`);--> statement-breakpoint
CREATE INDEX `idx_sms_out_created` ON `sms_orchestration_outcomes` (`createdAt`);