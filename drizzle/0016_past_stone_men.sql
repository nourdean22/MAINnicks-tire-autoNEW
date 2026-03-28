CREATE TABLE `appointment_reminders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`booking_id` int NOT NULL,
	`type` varchar(30) NOT NULL,
	`scheduled_for` timestamp,
	`sent_at` timestamp,
	`sms_sid` varchar(100),
	`status` varchar(20) NOT NULL DEFAULT 'pending',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `appointment_reminders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` varchar(36) NOT NULL,
	`actor` varchar(100) NOT NULL,
	`action` varchar(100) NOT NULL,
	`entity_type` varchar(50),
	`entity_id` varchar(36),
	`changes` json,
	`ip_address` varchar(45),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `communication_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`customer_id` int,
	`customer_phone` varchar(20),
	`type` varchar(20) NOT NULL,
	`direction` varchar(10) NOT NULL,
	`subject` varchar(255),
	`body` text,
	`metadata` json,
	`staff_name` varchar(100),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `communication_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `cron_log` (
	`id` varchar(36) NOT NULL,
	`job_name` varchar(100) NOT NULL,
	`status` varchar(20) NOT NULL,
	`duration_ms` int,
	`records_processed` int DEFAULT 0,
	`details` text,
	`error_message` text,
	`started_at` timestamp NOT NULL,
	`completed_at` timestamp,
	CONSTRAINT `cron_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `emergency_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`phone` varchar(20) NOT NULL,
	`vehicle` varchar(200),
	`problem` text,
	`urgency` varchar(20) DEFAULT 'normal',
	`status` varchar(20) DEFAULT 'new',
	`source` varchar(50) DEFAULT 'after_hours',
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `emergency_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `error_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`source` varchar(20) NOT NULL,
	`message` text NOT NULL,
	`stack` text,
	`url` varchar(500),
	`user_agent` varchar(500),
	`metadata` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `error_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `feature_flags` (
	`id` int AUTO_INCREMENT NOT NULL,
	`key` varchar(100) NOT NULL,
	`value` boolean NOT NULL DEFAULT false,
	`description` varchar(500),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `feature_flags_id` PRIMARY KEY(`id`),
	CONSTRAINT `feature_flags_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `form_abandonment` (
	`id` int AUTO_INCREMENT NOT NULL,
	`phone` varchar(20),
	`name` varchar(100),
	`email` varchar(255),
	`form_type` varchar(50) NOT NULL,
	`fields_completed` json,
	`recovery_sms_sent` boolean DEFAULT false,
	`recovered` boolean DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `form_abandonment_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `integration_failures` (
	`id` int AUTO_INCREMENT NOT NULL,
	`failureType` enum('sheets_sync','email','sms','capi','review_request','reminders','invoice') NOT NULL,
	`entityId` int,
	`entityType` enum('booking','lead','invoice','reminder','review') NOT NULL,
	`errorMessage` text NOT NULL,
	`errorDetails` text,
	`resolvedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `integration_failures_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `inventory` (
	`id` varchar(36) NOT NULL,
	`sku` varchar(50),
	`name` varchar(200) NOT NULL,
	`category` varchar(30) NOT NULL,
	`brand` varchar(100),
	`size` varchar(50),
	`quantity_on_hand` int NOT NULL DEFAULT 0,
	`quantity_reserved` int NOT NULL DEFAULT 0,
	`reorder_threshold` int NOT NULL DEFAULT 2,
	`cost` decimal(10,2),
	`retail_price` decimal(10,2),
	`supplier` varchar(100),
	`supplier_part_number` varchar(100),
	`location` varchar(50),
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `inventory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `otp_codes` (
	`id` varchar(36) NOT NULL,
	`phone` varchar(20) NOT NULL,
	`code` varchar(6) NOT NULL,
	`expires_at` timestamp NOT NULL,
	`used` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `otp_codes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`customer_id` int,
	`customer_phone` varchar(20),
	`customer_name` varchar(200),
	`amount` int NOT NULL,
	`description` varchar(500),
	`stripe_payment_link_id` varchar(255),
	`stripe_payment_intent_id` varchar(255),
	`status` varchar(20) NOT NULL DEFAULT 'pending',
	`paid_at` timestamp,
	`invoice_id` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `payments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` varchar(36) NOT NULL,
	`customer_id` varchar(36),
	`endpoint` text NOT NULL,
	`p256dh` varchar(255) NOT NULL,
	`auth_key` varchar(255) NOT NULL,
	`is_admin` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `push_subscriptions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `review_replies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`review_id` varchar(200) NOT NULL,
	`reviewer_name` varchar(100),
	`review_rating` int,
	`review_text` text,
	`review_date` timestamp,
	`draft_reply` text,
	`final_reply` text,
	`status` varchar(20) DEFAULT 'draft',
	`approved_at` timestamp,
	`posted_at` timestamp,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `review_replies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `share_cards` (
	`id` int AUTO_INCREMENT NOT NULL,
	`token` varchar(64) NOT NULL,
	`customer_name` varchar(100),
	`vehicle_info` varchar(200),
	`service_type` varchar(100),
	`health_score` int,
	`health_details` text,
	`completed_date` timestamp,
	`inspection_id` int,
	`views` int DEFAULT 0,
	`shares` int DEFAULT 0,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `share_cards_id` PRIMARY KEY(`id`),
	CONSTRAINT `share_cards_token_unique` UNIQUE(`token`)
);
--> statement-breakpoint
CREATE TABLE `sms_campaign_sends` (
	`id` int AUTO_INCREMENT NOT NULL,
	`campaignId` int NOT NULL,
	`customerId` int NOT NULL,
	`phone` varchar(20) NOT NULL,
	`messageBody` text NOT NULL,
	`twilioSid` varchar(100),
	`status` enum('pending','sent','failed') NOT NULL DEFAULT 'pending',
	`errorMessage` text,
	`sentAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sms_campaign_sends_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sms_campaigns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`template` enum('maintenance','seasonal','special_offer','winback') NOT NULL,
	`segment` enum('recent','lapsed','all') NOT NULL,
	`customMessage` text,
	`targetCount` int NOT NULL DEFAULT 0,
	`sentCount` int NOT NULL DEFAULT 0,
	`failedCount` int NOT NULL DEFAULT 0,
	`status` enum('draft','active','completed') NOT NULL DEFAULT 'draft',
	`startedAt` timestamp,
	`completedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `sms_campaigns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sms_preferences` (
	`id` int AUTO_INCREMENT NOT NULL,
	`phone` varchar(20) NOT NULL,
	`opted_out` boolean NOT NULL DEFAULT false,
	`opt_out_keyword` varchar(20),
	`opted_out_at` timestamp,
	`opted_in_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `sms_preferences_id` PRIMARY KEY(`id`),
	CONSTRAINT `sms_preferences_phone_unique` UNIQUE(`phone`)
);
--> statement-breakpoint
CREATE TABLE `specials` (
	`id` varchar(36) NOT NULL,
	`title` varchar(200) NOT NULL,
	`description` text,
	`discount_type` varchar(20) NOT NULL,
	`discount_value` decimal(10,2),
	`service_category` varchar(100),
	`conditions` text,
	`coupon_code` varchar(50),
	`starts_at` timestamp NOT NULL,
	`expires_at` timestamp,
	`max_uses` int,
	`current_uses` int NOT NULL DEFAULT 0,
	`is_active` boolean NOT NULL DEFAULT true,
	`display_on_website` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `specials_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `vehicles` (
	`id` varchar(36) NOT NULL,
	`customer_id` varchar(36) NOT NULL,
	`year` int,
	`make` varchar(50),
	`model` varchar(50),
	`trim_level` varchar(50),
	`vin` varchar(17),
	`license_plate` varchar(20),
	`color` varchar(30),
	`mileage` int,
	`mileage_updated_at` timestamp,
	`tire_size` varchar(30),
	`engine` varchar(50),
	`transmission` varchar(20),
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `vehicles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `waitlist` (
	`id` varchar(36) NOT NULL,
	`customer_name` varchar(200) NOT NULL,
	`customer_phone` varchar(20) NOT NULL,
	`customer_email` varchar(255),
	`service_type` varchar(100),
	`preferred_date` date,
	`notes` text,
	`status` varchar(20) NOT NULL DEFAULT 'waiting',
	`notified_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `waitlist_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `warranties` (
	`id` varchar(36) NOT NULL,
	`work_order_id` varchar(36) NOT NULL,
	`customer_id` varchar(36) NOT NULL,
	`vehicle_id` varchar(36),
	`service_description` varchar(500),
	`warranty_months` int NOT NULL,
	`warranty_miles` int,
	`starts_at` date NOT NULL,
	`expires_at` date NOT NULL,
	`mileage_at_service` int,
	`status` varchar(20) NOT NULL DEFAULT 'active',
	`reminder_sent` boolean NOT NULL DEFAULT false,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `warranties_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` varchar(36) NOT NULL,
	`webhook_name` varchar(100) NOT NULL,
	`url` varchar(500) NOT NULL,
	`method` varchar(10) NOT NULL DEFAULT 'POST',
	`payload` json NOT NULL,
	`response_status` int,
	`response_body` text,
	`error_message` text,
	`attempt_count` int NOT NULL DEFAULT 0,
	`max_attempts` int NOT NULL DEFAULT 5,
	`status` varchar(20) NOT NULL DEFAULT 'pending',
	`next_retry_at` timestamp,
	`delivered_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `webhook_deliveries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `work_order_items` (
	`id` varchar(36) NOT NULL,
	`work_order_id` varchar(36) NOT NULL,
	`type` varchar(20) NOT NULL,
	`description` varchar(500) NOT NULL,
	`part_number` varchar(50),
	`quantity` decimal(10,2) DEFAULT '1',
	`unit_cost` decimal(10,2) DEFAULT '0',
	`unit_price` decimal(10,2) DEFAULT '0',
	`total` decimal(10,2) DEFAULT '0',
	`tech_name` varchar(100),
	`labor_hours` decimal(5,2),
	`warranty_covered` boolean DEFAULT false,
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `work_order_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `work_orders` (
	`id` varchar(36) NOT NULL,
	`order_number` varchar(20) NOT NULL,
	`customer_id` varchar(36) NOT NULL,
	`vehicle_id` varchar(36),
	`status` varchar(30) NOT NULL DEFAULT 'pending',
	`priority` varchar(10) NOT NULL DEFAULT 'normal',
	`assigned_bay` varchar(10),
	`assigned_tech` varchar(100),
	`diagnosis` text,
	`customer_complaint` text,
	`internal_notes` text,
	`estimated_completion` timestamp,
	`actual_completion` timestamp,
	`parts_cost` decimal(10,2) DEFAULT '0',
	`labor_cost` decimal(10,2) DEFAULT '0',
	`tax` decimal(10,2) DEFAULT '0',
	`discount` decimal(10,2) DEFAULT '0',
	`total` decimal(10,2) DEFAULT '0',
	`payment_method` varchar(50),
	`payment_status` varchar(20) NOT NULL DEFAULT 'unpaid',
	`warranty_months` int DEFAULT 0,
	`warranty_miles` int DEFAULT 0,
	`warranty_expires_at` timestamp,
	`source` varchar(50),
	`booking_id` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `work_orders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `leads` MODIFY COLUMN `status` enum('new','contacted','booked','completed','closed','lost') NOT NULL DEFAULT 'new';--> statement-breakpoint
ALTER TABLE `customers` ADD `smsOptOut` int DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_remind_booking` ON `appointment_reminders` (`booking_id`);--> statement-breakpoint
CREATE INDEX `idx_remind_type` ON `appointment_reminders` (`type`);--> statement-breakpoint
CREATE INDEX `idx_remind_status` ON `appointment_reminders` (`status`);--> statement-breakpoint
CREATE INDEX `idx_remind_scheduled` ON `appointment_reminders` (`scheduled_for`);--> statement-breakpoint
CREATE INDEX `idx_audit_actor` ON `audit_log` (`actor`);--> statement-breakpoint
CREATE INDEX `idx_audit_entity` ON `audit_log` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_created` ON `audit_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_comm_customer_id` ON `communication_log` (`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_comm_phone` ON `communication_log` (`customer_phone`);--> statement-breakpoint
CREATE INDEX `idx_comm_type` ON `communication_log` (`type`);--> statement-breakpoint
CREATE INDEX `idx_comm_created` ON `communication_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_cron_job` ON `cron_log` (`job_name`);--> statement-breakpoint
CREATE INDEX `idx_cron_started` ON `cron_log` (`started_at`);--> statement-breakpoint
CREATE INDEX `idx_error_source` ON `error_log` (`source`);--> statement-breakpoint
CREATE INDEX `idx_error_created` ON `error_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_flag_key` ON `feature_flags` (`key`);--> statement-breakpoint
CREATE INDEX `idx_abandon_phone` ON `form_abandonment` (`phone`);--> statement-breakpoint
CREATE INDEX `idx_abandon_created` ON `form_abandonment` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_abandon_recovered` ON `form_abandonment` (`recovered`);--> statement-breakpoint
CREATE INDEX `idx_inv_sku` ON `inventory` (`sku`);--> statement-breakpoint
CREATE INDEX `idx_inv_category` ON `inventory` (`category`);--> statement-breakpoint
CREATE INDEX `idx_inv_low_stock` ON `inventory` (`quantity_on_hand`,`reorder_threshold`);--> statement-breakpoint
CREATE INDEX `idx_otp_phone` ON `otp_codes` (`phone`);--> statement-breakpoint
CREATE INDEX `idx_otp_expires` ON `otp_codes` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_pay_customer` ON `payments` (`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_pay_status` ON `payments` (`status`);--> statement-breakpoint
CREATE INDEX `idx_pay_stripe` ON `payments` (`stripe_payment_intent_id`);--> statement-breakpoint
CREATE INDEX `idx_pay_created` ON `payments` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_push_customer` ON `push_subscriptions` (`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_push_admin` ON `push_subscriptions` (`is_admin`);--> statement-breakpoint
CREATE INDEX `idx_special_active` ON `specials` (`is_active`,`starts_at`,`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_special_code` ON `specials` (`coupon_code`);--> statement-breakpoint
CREATE INDEX `idx_veh_customer` ON `vehicles` (`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_veh_vin` ON `vehicles` (`vin`);--> statement-breakpoint
CREATE INDEX `idx_wait_status` ON `waitlist` (`status`);--> statement-breakpoint
CREATE INDEX `idx_warr_customer` ON `warranties` (`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_warr_expires` ON `warranties` (`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_warr_status` ON `warranties` (`status`);--> statement-breakpoint
CREATE INDEX `idx_wh_status` ON `webhook_deliveries` (`status`);--> statement-breakpoint
CREATE INDEX `idx_wh_next_retry` ON `webhook_deliveries` (`next_retry_at`);--> statement-breakpoint
CREATE INDEX `idx_woi_work_order` ON `work_order_items` (`work_order_id`);--> statement-breakpoint
CREATE INDEX `idx_wo_customer` ON `work_orders` (`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_wo_status` ON `work_orders` (`status`);--> statement-breakpoint
CREATE INDEX `idx_wo_created` ON `work_orders` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_wo_order_num` ON `work_orders` (`order_number`);