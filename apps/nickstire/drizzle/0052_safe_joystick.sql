CREATE TABLE `app_secret_kv` (
	`k` varchar(64) NOT NULL,
	`v` text NOT NULL,
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `app_secret_kv_k` PRIMARY KEY(`k`)
);
--> statement-breakpoint
CREATE TABLE `competitor_snapshots` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`competitor_name` varchar(160) NOT NULL,
	`place_id` varchar(128) NOT NULL,
	`rating` decimal(3,2) NOT NULL DEFAULT '0',
	`review_count` int NOT NULL DEFAULT 0,
	`source` varchar(32) NOT NULL DEFAULT 'google_places',
	`captured_at` timestamp NOT NULL DEFAULT (now()),
	`raw_payload` text,
	CONSTRAINT `competitor_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `confirmation_calls` (
	`id` int AUTO_INCREMENT NOT NULL,
	`booking_id` int NOT NULL,
	`attempted_at` timestamp NOT NULL DEFAULT (now()),
	`completed_at` timestamp,
	`agentphone_call_id` varchar(64),
	`status` enum('pending','dialing','confirmed','rescheduled','no_answer','failed') NOT NULL DEFAULT 'pending',
	`transcript_snippet` text,
	`reschedule_request` text,
	`error_message` text,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `confirmation_calls_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `cron_alerts_fired` (
	`alert_key` varchar(100) NOT NULL,
	`fired_for` timestamp NOT NULL,
	`fired_at` timestamp NOT NULL DEFAULT (now()),
	`payload` text,
	CONSTRAINT `cron_alerts_fired_alert_key_fired_for_pk` PRIMARY KEY(`alert_key`,`fired_for`)
);
--> statement-breakpoint
CREATE TABLE `cron_locks` (
	`name` varchar(100) NOT NULL,
	`lock_token` varchar(36) NOT NULL,
	`holder` varchar(100) NOT NULL,
	`locked_at` timestamp NOT NULL DEFAULT (now()),
	`locked_until` timestamp NOT NULL,
	CONSTRAINT `cron_locks_name` PRIMARY KEY(`name`)
);
--> statement-breakpoint
CREATE TABLE `cron_tier_skip_state` (
	`tier_name` varchar(50) NOT NULL,
	`consecutive_skips` int NOT NULL DEFAULT 0,
	`last_skip_at` timestamp,
	`last_run_at` timestamp,
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `cron_tier_skip_state_tier_name` PRIMARY KEY(`tier_name`)
);
--> statement-breakpoint
CREATE TABLE `drip_enrollments` (
	`id` varchar(36) NOT NULL,
	`campaignId` varchar(50) NOT NULL,
	`customerPhone` varchar(20) NOT NULL,
	`customerName` varchar(100),
	`currentStep` int DEFAULT 0,
	`status` enum('active','completed','cancelled','converted') DEFAULT 'active',
	`enrolledAt` datetime,
	`nextStepAt` datetime,
	`metadata` json,
	CONSTRAINT `drip_enrollments_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_drip_active` UNIQUE(`customerPhone`,`campaignId`,`status`)
);
--> statement-breakpoint
CREATE TABLE `event_dlq` (
	`id` int AUTO_INCREMENT NOT NULL,
	`eventType` varchar(64) NOT NULL,
	`destination` varchar(64) NOT NULL,
	`error` varchar(500) NOT NULL,
	`payload` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`alertedAt` timestamp,
	CONSTRAINT `event_dlq_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ig_autopost_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`archetype` varchar(20) NOT NULL,
	`conceptKey` varchar(64) NOT NULL,
	`slot` varchar(16) NOT NULL DEFAULT 'manual',
	`slotDate` varchar(10) NOT NULL,
	`evalScoresJson` text,
	`captionWeighted` int,
	`overallScore` int,
	`status` varchar(16) NOT NULL,
	`caption` text NOT NULL,
	`hashtags` text,
	`imagePrompt` text,
	`imageUrl` varchar(1000),
	`igPostId` varchar(64),
	`fbPostId` varchar(64),
	`error` varchar(500),
	`source` varchar(16) NOT NULL DEFAULT 'cron',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ig_autopost_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `lifecycle_tracker_events` (
	`phone10` varchar(10) NOT NULL,
	`customerName` varchar(255),
	`events` json NOT NULL,
	`convertedAt` timestamp,
	`firstSeenAt` timestamp NOT NULL DEFAULT (now()),
	`lastSeenAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `lifecycle_tracker_events_phone10` PRIMARY KEY(`phone10`)
);
--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` int AUTO_INCREMENT NOT NULL,
	`plan` varchar(64) NOT NULL DEFAULT 'nonstop-nick',
	`phone` varchar(20) NOT NULL,
	`name` varchar(255),
	`email` varchar(320),
	`vehiclePlate` varchar(16),
	`vehicleDesc` varchar(255),
	`status` enum('active','past_due','canceled','incomplete') NOT NULL DEFAULT 'incomplete',
	`stripeCustomerId` varchar(64),
	`stripeSubscriptionId` varchar(64),
	`currentPeriodEnd` timestamp,
	`canceledAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `memberships_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_membership_stripe_sub` UNIQUE(`stripeSubscriptionId`)
);
--> statement-breakpoint
CREATE TABLE `otp_attempts` (
	`phone` varchar(30) NOT NULL,
	`attempt_count` int NOT NULL DEFAULT 0,
	`window_started_at` timestamp NOT NULL DEFAULT (now()),
	`blocked_until` timestamp,
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `otp_attempts_phone` PRIMARY KEY(`phone`)
);
--> statement-breakpoint
CREATE TABLE `payment_alert_backlog` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tireOrderNumber` varchar(64),
	`invoiceNumber` varchar(64),
	`amountCents` int NOT NULL,
	`summary` varchar(500) NOT NULL,
	`failureReason` enum('email_failed','telegram_failed','both_failed') NOT NULL,
	`resolvedAt` timestamp,
	`resolvedBy` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `payment_alert_backlog_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `prediction_actions` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`prediction_id` bigint NOT NULL,
	`action` varchar(32) NOT NULL,
	`acted_at` timestamp NOT NULL DEFAULT (now()),
	`operator_id` varchar(64),
	CONSTRAINT `prediction_actions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `prediction_impressions` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`prediction_id` bigint NOT NULL,
	`shown_at` timestamp NOT NULL DEFAULT (now()),
	`surface` varchar(64) NOT NULL,
	`operator_id` varchar(64),
	CONSTRAINT `prediction_impressions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `prediction_outcomes` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`prediction_id` bigint NOT NULL,
	`invoice_id` bigint,
	`matched` boolean NOT NULL,
	`resolved_at` timestamp NOT NULL DEFAULT (now()),
	`window_days` int NOT NULL,
	CONSTRAINT `prediction_outcomes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `service_affinity_predictions` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`customer_id` int NOT NULL,
	`predicted_service` varchar(64) NOT NULL,
	`confidence` decimal(5,4) NOT NULL,
	`features_json` json NOT NULL,
	`model_version` varchar(32) NOT NULL,
	`ab_arm` enum('treatment','control') NOT NULL DEFAULT 'treatment',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `service_affinity_predictions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sms_rate_limit` (
	`phone` varchar(30) NOT NULL,
	`count_24h` int NOT NULL DEFAULT 0,
	`window_started_at` timestamp NOT NULL DEFAULT (now()),
	`last_sent_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sms_rate_limit_phone` PRIMARY KEY(`phone`)
);
--> statement-breakpoint
CREATE TABLE `user_roles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int NOT NULL,
	`role` varchar(32) NOT NULL,
	`notes` varchar(255),
	`granted_by` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`expires_at` timestamp,
	CONSTRAINT `user_roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_roles_userId_role_uniq` UNIQUE(`user_id`,`role`)
);
--> statement-breakpoint
CREATE TABLE `vapi_call_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`vapiCallId` varchar(64) NOT NULL,
	`phoneNumber` varchar(30),
	`customerName` varchar(255),
	`durationSeconds` int NOT NULL DEFAULT 0,
	`endedReason` varchar(64),
	`aiSummary` text,
	`serviceMention` varchar(120),
	`convertedToLead` int NOT NULL DEFAULT 0,
	`leadId` int,
	`callbackId` int,
	`transcriptUrl` varchar(500),
	`recordingUrl` varchar(500),
	`eval_score` int,
	`eval_outcome` varchar(32),
	`eval_reasoning` text,
	`eval_at` timestamp,
	`metadata` json,
	`audited_at` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `vapi_call_logs_id` PRIMARY KEY(`id`),
	CONSTRAINT `vapi_call_logs_vapiCallId_unique` UNIQUE(`vapiCallId`)
);
--> statement-breakpoint
CREATE TABLE `voice_followups` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int NOT NULL,
	`touch` enum('d7','d30','d60') NOT NULL,
	`phone` varchar(30),
	`customerName` varchar(255),
	`status` enum('called','failed','skipped') NOT NULL DEFAULT 'called',
	`vapiCallId` varchar(64),
	`errorMessage` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `voice_followups_id` PRIMARY KEY(`id`),
	CONSTRAINT `uniq_booking_touch` UNIQUE(`bookingId`,`touch`)
);
--> statement-breakpoint
CREATE TABLE `voice_latency_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`call_id` varchar(64) NOT NULL,
	`assistant_id` varchar(64) NOT NULL,
	`stage` varchar(32) NOT NULL,
	`latency_ms` int NOT NULL,
	`metadata` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `voice_latency_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `wave_metrics` (
	`id` bigint AUTO_INCREMENT NOT NULL,
	`wave_id` varchar(64) NOT NULL,
	`metric_key` varchar(64) NOT NULL,
	`baseline_value` decimal(12,4) NOT NULL,
	`measure_at` timestamp NOT NULL,
	`measured_value` decimal(12,4),
	`delta_percent` decimal(8,2),
	`status` enum('pending','lifted','no_lift','regression','resolver_error') NOT NULL DEFAULT 'pending',
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`measured_at` timestamp,
	CONSTRAINT `wave_metrics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
DROP INDEX `idx_customer_phone` ON `customers`;--> statement-breakpoint
ALTER TABLE `comebacks` MODIFY COLUMN `customer_id` int;--> statement-breakpoint
ALTER TABLE `customer_status_messages` MODIFY COLUMN `customer_id` int;--> statement-breakpoint
ALTER TABLE `push_subscriptions` MODIFY COLUMN `customer_id` int;--> statement-breakpoint
ALTER TABLE `sms_messages` MODIFY COLUMN `status` enum('queued','sent','delivered','failed','received','sending') NOT NULL DEFAULT 'queued';--> statement-breakpoint
ALTER TABLE `vehicles` MODIFY COLUMN `customer_id` int NOT NULL;--> statement-breakpoint
ALTER TABLE `warranties` MODIFY COLUMN `customer_id` int;--> statement-breakpoint
ALTER TABLE `winback_campaigns` MODIFY COLUMN `targetSegment` enum('lapsed','unknown','recent','dormant','lost','vip','fleet','tire_customer') NOT NULL;--> statement-breakpoint
ALTER TABLE `work_orders` MODIFY COLUMN `customer_id` int;--> statement-breakpoint
ALTER TABLE `alg_estimates` ADD `customer_id` int;--> statement-breakpoint
ALTER TABLE `alg_estimates` ADD `vin` varchar(17);--> statement-breakpoint
ALTER TABLE `alg_estimates` ADD `labor_rate` int DEFAULT 11500 NOT NULL;--> statement-breakpoint
ALTER TABLE `alg_estimates` ADD `service_category` varchar(64);--> statement-breakpoint
ALTER TABLE `alg_estimates` ADD `estimated_labor_cost` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `alg_estimates` ADD `estimated_parts_cost` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `alg_estimates` ADD `follow_up_3d_sent` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `alg_estimates` ADD `follow_up_3d_attempted_at` timestamp;--> statement-breakpoint
ALTER TABLE `alg_estimates` ADD `follow_up_3d_sent_at` timestamp;--> statement-breakpoint
ALTER TABLE `alg_estimates` ADD `follow_up_7d_attempted_at` timestamp;--> statement-breakpoint
ALTER TABLE `alg_estimates` ADD `follow_up_14d_sent` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `alg_estimates` ADD `follow_up_14d_attempted_at` timestamp;--> statement-breakpoint
ALTER TABLE `alg_estimates` ADD `follow_up_14d_sent_at` timestamp;--> statement-breakpoint
ALTER TABLE `alg_estimates` ADD `follow_up_30d_attempted_at` timestamp;--> statement-breakpoint
ALTER TABLE `alg_estimates` ADD `follow_up_45d_sent` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `alg_estimates` ADD `follow_up_45d_attempted_at` timestamp;--> statement-breakpoint
ALTER TABLE `alg_estimates` ADD `follow_up_45d_sent_at` timestamp;--> statement-breakpoint
ALTER TABLE `alg_estimates` ADD `recovery_profile` varchar(8);--> statement-breakpoint
ALTER TABLE `alg_estimates` ADD `voice_recovery_attempted_at` timestamp;--> statement-breakpoint
ALTER TABLE `alg_estimates` ADD `voice_recovery_call_id` varchar(64);--> statement-breakpoint
ALTER TABLE `alg_estimates` ADD `voice_recovery_outcome` enum('pending','dialing','interested','not_interested','no_answer','failed');--> statement-breakpoint
ALTER TABLE `bookings` ADD `sessionId` varchar(64);--> statement-breakpoint
ALTER TABLE `call_events` ADD `sessionId` varchar(64);--> statement-breakpoint
ALTER TABLE `call_events` ADD `eventId` varchar(64);--> statement-breakpoint
ALTER TABLE `callback_requests` ADD `utmContent` varchar(255);--> statement-breakpoint
ALTER TABLE `callback_requests` ADD `utmTerm` varchar(255);--> statement-breakpoint
ALTER TABLE `callback_requests` ADD `sessionId` varchar(64);--> statement-breakpoint
ALTER TABLE `customer_metrics` ADD `declinedValue` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `customer_metrics` ADD `declinedCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `customer_metrics` ADD `backlogValueCents` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `customer_metrics` ADD `backlogCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `customers` ADD `psycho_profile` varchar(32);--> statement-breakpoint
ALTER TABLE `customers` ADD `psycho_profile_score` int;--> statement-breakpoint
ALTER TABLE `customers` ADD `psycho_profile_at` timestamp;--> statement-breakpoint
ALTER TABLE `invoices` ADD `algTicketId` varchar(64);--> statement-breakpoint
ALTER TABLE `leads` ADD `utmContent` varchar(255);--> statement-breakpoint
ALTER TABLE `leads` ADD `utmTerm` varchar(255);--> statement-breakpoint
ALTER TABLE `leads` ADD `sessionId` varchar(64);--> statement-breakpoint
ALTER TABLE `leads` ADD `callbackId` int;--> statement-breakpoint
ALTER TABLE `leads` ADD `bookingId` int;--> statement-breakpoint
ALTER TABLE `leads` ADD `invoiceId` int;--> statement-breakpoint
ALTER TABLE `sms_messages` ADD `replyCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sms_messages` ADD `firstReplyAt` timestamp;--> statement-breakpoint
ALTER TABLE `sms_messages` ADD `optOutAt` timestamp;--> statement-breakpoint
ALTER TABLE `sms_messages` ADD `convertedCount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `sms_messages` ADD `attributedBookingId` int;--> statement-breakpoint
ALTER TABLE `sms_messages` ADD `attributedAt` timestamp;--> statement-breakpoint
ALTER TABLE `sms_messages` ADD `variantKey` varchar(50);--> statement-breakpoint
ALTER TABLE `tire_orders` ADD `utmSource` varchar(100);--> statement-breakpoint
ALTER TABLE `tire_orders` ADD `utmMedium` varchar(100);--> statement-breakpoint
ALTER TABLE `tire_orders` ADD `utmCampaign` varchar(255);--> statement-breakpoint
ALTER TABLE `tire_orders` ADD `landingPage` varchar(500);--> statement-breakpoint
ALTER TABLE `tire_orders` ADD `referrer` varchar(500);--> statement-breakpoint
ALTER TABLE `tire_orders` ADD `sessionId` varchar(64);--> statement-breakpoint
ALTER TABLE `tire_orders` ADD `invoiceNumber` varchar(50);--> statement-breakpoint
ALTER TABLE `tire_orders` ADD `paymentStatus` varchar(20) DEFAULT 'unpaid' NOT NULL;--> statement-breakpoint
ALTER TABLE `tire_orders` ADD `stripeSessionId` varchar(255);--> statement-breakpoint
ALTER TABLE `tire_orders` ADD `paidAt` timestamp;--> statement-breakpoint
ALTER TABLE `customers` ADD CONSTRAINT `uniq_customer_phone` UNIQUE(`phone`);--> statement-breakpoint
ALTER TABLE `search_performance` ADD CONSTRAINT `uq_search_perf_date_query_page` UNIQUE(`date`,`query`,`page`);--> statement-breakpoint
CREATE INDEX `idx_competitor_captured` ON `competitor_snapshots` (`place_id`,`captured_at`);--> statement-breakpoint
CREATE INDEX `idx_captured_at` ON `competitor_snapshots` (`captured_at`);--> statement-breakpoint
CREATE INDEX `idx_cron_alerts_fired_fired_at` ON `cron_alerts_fired` (`fired_at`);--> statement-breakpoint
CREATE INDEX `idx_status_next` ON `drip_enrollments` (`status`,`nextStepAt`);--> statement-breakpoint
CREATE INDEX `idx_phone_campaign` ON `drip_enrollments` (`customerPhone`,`campaignId`);--> statement-breakpoint
CREATE INDEX `idx_ig_autopost_created` ON `ig_autopost_log` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_ig_autopost_slot_day` ON `ig_autopost_log` (`slot`,`slotDate`);--> statement-breakpoint
CREATE INDEX `idx_ig_autopost_status` ON `ig_autopost_log` (`status`);--> statement-breakpoint
CREATE INDEX `idx_membership_phone` ON `memberships` (`phone`);--> statement-breakpoint
CREATE INDEX `idx_membership_status` ON `memberships` (`status`);--> statement-breakpoint
CREATE INDEX `idx_prediction_acted` ON `prediction_actions` (`prediction_id`,`acted_at`);--> statement-breakpoint
CREATE INDEX `idx_action_acted` ON `prediction_actions` (`action`,`acted_at`);--> statement-breakpoint
CREATE INDEX `idx_prediction_shown` ON `prediction_impressions` (`prediction_id`,`shown_at`);--> statement-breakpoint
CREATE INDEX `idx_prediction` ON `prediction_outcomes` (`prediction_id`);--> statement-breakpoint
CREATE INDEX `idx_resolved` ON `prediction_outcomes` (`resolved_at`);--> statement-breakpoint
CREATE INDEX `idx_customer_created` ON `service_affinity_predictions` (`customer_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_model_created` ON `service_affinity_predictions` (`model_version`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_ab_arm_created` ON `service_affinity_predictions` (`ab_arm`,`created_at`);--> statement-breakpoint
CREATE INDEX `user_roles_userId_idx` ON `user_roles` (`user_id`);--> statement-breakpoint
CREATE INDEX `user_roles_role_idx` ON `user_roles` (`role`);--> statement-breakpoint
CREATE INDEX `idx_vapi_log_created` ON `vapi_call_logs` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_vapi_log_phone` ON `vapi_call_logs` (`phoneNumber`);--> statement-breakpoint
CREATE INDEX `idx_vapi_log_lead` ON `vapi_call_logs` (`leadId`);--> statement-breakpoint
CREATE INDEX `idx_vapi_eval_at_score` ON `vapi_call_logs` (`eval_at`,`eval_score`);--> statement-breakpoint
CREATE INDEX `idx_vapi_audited_at` ON `vapi_call_logs` (`audited_at`);--> statement-breakpoint
CREATE INDEX `idx_followup_created` ON `voice_followups` (`createdAt`);--> statement-breakpoint
CREATE INDEX `voice_latency_events_call_stage_idx` ON `voice_latency_events` (`call_id`,`stage`);--> statement-breakpoint
CREATE INDEX `voice_latency_events_created_at_idx` ON `voice_latency_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_wave_measure_at` ON `wave_metrics` (`status`,`measure_at`);--> statement-breakpoint
CREATE INDEX `idx_wave_id` ON `wave_metrics` (`wave_id`);--> statement-breakpoint
CREATE INDEX `idx_alg_est_customer_name` ON `alg_estimates` (`customer_name`);--> statement-breakpoint
CREATE INDEX `idx_alg_est_source` ON `alg_estimates` (`source`);--> statement-breakpoint
CREATE INDEX `idx_alg_est_recovery_profile` ON `alg_estimates` (`recovery_profile`);--> statement-breakpoint
CREATE INDEX `idx_callback_status` ON `callback_requests` (`status`);--> statement-breakpoint
CREATE INDEX `idx_cm_customer_id` ON `customer_metrics` (`customerId`);--> statement-breakpoint
CREATE INDEX `idx_notification_status` ON `customer_notifications` (`status`);--> statement-breakpoint
CREATE INDEX `idx_customer_psycho` ON `customers` (`psycho_profile`);--> statement-breakpoint
CREATE INDEX `idx_invoice_customer_id` ON `invoices` (`customerId`);--> statement-breakpoint
CREATE INDEX `idx_invoice_customer_phone` ON `invoices` (`customerPhone`);--> statement-breakpoint
CREATE INDEX `idx_invoice_source` ON `invoices` (`source`);--> statement-breakpoint
CREATE INDEX `idx_invoice_date_status` ON `invoices` (`invoiceDate`,`paymentStatus`);--> statement-breakpoint
CREATE INDEX `idx_invoice_alg_ticket` ON `invoices` (`algTicketId`);--> statement-breakpoint
CREATE INDEX `idx_lead_callback_id` ON `leads` (`callbackId`);--> statement-breakpoint
CREATE INDEX `idx_lead_booking_id` ON `leads` (`bookingId`);--> statement-breakpoint
CREATE INDEX `idx_lead_invoice_id` ON `leads` (`invoiceId`);--> statement-breakpoint
CREATE INDEX `sms_attribution_idx` ON `sms_messages` (`direction`,`createdAt`);--> statement-breakpoint
CREATE INDEX `sms_variant_idx` ON `sms_messages` (`variantKey`,`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_sms_msg_twilio_sid` ON `sms_messages` (`twilioSid`);