CREATE TABLE `bays` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(20) NOT NULL,
	`type` varchar(30) NOT NULL,
	`capabilities` json,
	`has_lift` boolean DEFAULT true,
	`lift_type` varchar(30),
	`active` boolean DEFAULT true,
	`current_work_order_id` varchar(36),
	`current_tech_id` int,
	`display_order` int DEFAULT 0,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bays_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `chat_analytics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`sessionId` int,
	`hourOfDay` int NOT NULL,
	`dayOfWeek` int NOT NULL,
	`month` int NOT NULL,
	`messageCount` int NOT NULL DEFAULT 0,
	`converted` int NOT NULL DEFAULT 0,
	`leadScore` int,
	`duration` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `chat_analytics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `comebacks` (
	`id` int AUTO_INCREMENT NOT NULL,
	`original_work_order_id` varchar(36) NOT NULL,
	`comeback_work_order_id` varchar(36),
	`customer_id` varchar(36) NOT NULL,
	`service_type` varchar(100),
	`original_tech_id` int,
	`days_since_original` int,
	`type` varchar(20) NOT NULL,
	`severity` varchar(20),
	`root_cause` varchar(50),
	`description` text,
	`resolution` text,
	`cost_to_shop` decimal(10,2),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `comebacks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `conversation_memory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`visitorKey` varchar(255) NOT NULL,
	`category` varchar(50) NOT NULL,
	`content` text NOT NULL,
	`sessionId` int,
	`confidence` float NOT NULL DEFAULT 0.8,
	`reinforcements` int NOT NULL DEFAULT 1,
	`conversionHits` int NOT NULL DEFAULT 0,
	`lastAccessed` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `conversation_memory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `customer_status_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`work_order_id` varchar(36) NOT NULL,
	`customer_id` varchar(36),
	`trigger` varchar(30) NOT NULL,
	`channel` varchar(10) NOT NULL,
	`recipient` varchar(100) NOT NULL,
	`message` text NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'sent',
	`sent_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `customer_status_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `daily_execution` (
	`id` int AUTO_INCREMENT NOT NULL,
	`date` date NOT NULL,
	`mission` text,
	`notes` text,
	`status` enum('on_track','drifting','off_track') NOT NULL DEFAULT 'on_track',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `daily_execution_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `daily_habits` (
	`id` int AUTO_INCREMENT NOT NULL,
	`date` date NOT NULL,
	`habit_key` varchar(50) NOT NULL,
	`completed` boolean NOT NULL DEFAULT false,
	`completed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `daily_habits_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `estimates_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`phone` varchar(30) NOT NULL,
	`name` varchar(255),
	`vehicle` varchar(255),
	`service` varchar(255) NOT NULL,
	`estimatedAmountCents` int,
	`estimatedLowCents` int,
	`estimatedHighCents` int,
	`source` enum('ai-estimator','manual','phone-quote') NOT NULL DEFAULT 'ai-estimator',
	`converted` int NOT NULL DEFAULT 0,
	`invoiceId` int,
	`bookingId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `estimates_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `instagram_analytics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`postId` varchar(100) NOT NULL,
	`postType` varchar(30),
	`caption` text,
	`likes` int NOT NULL DEFAULT 0,
	`comments` int NOT NULL DEFAULT 0,
	`engagementRate` int NOT NULL DEFAULT 0,
	`postedAt` varchar(30),
	`dayOfWeek` int,
	`hourOfDay` int,
	`contentScore` int,
	`themesJson` text,
	`followerSnapshot` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `instagram_analytics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `pipeline_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`pipelineName` varchar(50) NOT NULL,
	`status` varchar(20) NOT NULL,
	`durationMs` int,
	`resultJson` text,
	`errorMessage` text,
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `pipeline_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `qc_checklists` (
	`id` int AUTO_INCREMENT NOT NULL,
	`work_order_id` varchar(36) NOT NULL,
	`completed_by` varchar(100),
	`reviewed_by` varchar(100),
	`status` varchar(20) NOT NULL DEFAULT 'pending',
	`items` json,
	`road_test_required` boolean DEFAULT false,
	`road_test_completed` boolean DEFAULT false,
	`road_test_notes` text,
	`road_test_mileage` int,
	`failure_reasons` json,
	`corrective_actions` text,
	`started_at` timestamp,
	`completed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `qc_checklists_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `review_pipeline` (
	`id` int AUTO_INCREMENT NOT NULL,
	`authorName` varchar(255) NOT NULL,
	`rating` int NOT NULL,
	`reviewText` text,
	`reviewTime` int,
	`relativeTime` varchar(100),
	`sentiment` varchar(20),
	`topicsJson` text,
	`suggestedResponse` text,
	`reviewed` int NOT NULL DEFAULT 0,
	`responseSent` int NOT NULL DEFAULT 0,
	`adminNotes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `review_pipeline_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `review_trends` (
	`id` int AUTO_INCREMENT NOT NULL,
	`snapshotDate` varchar(10) NOT NULL,
	`avgRating` int NOT NULL,
	`totalReviews` int NOT NULL,
	`negativeCount` int NOT NULL DEFAULT 0,
	`positiveCount` int NOT NULL DEFAULT 0,
	`topKeywordsJson` text,
	`sentimentDistJson` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `review_trends_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `search_performance` (
	`id` int AUTO_INCREMENT NOT NULL,
	`query` varchar(500) NOT NULL,
	`page` varchar(1000),
	`clicks` int NOT NULL DEFAULT 0,
	`impressions` int NOT NULL DEFAULT 0,
	`ctr` int NOT NULL DEFAULT 0,
	`position` int NOT NULL DEFAULT 0,
	`date` varchar(10) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `search_performance_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `work_order_transitions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`work_order_id` varchar(36) NOT NULL,
	`from_status` varchar(30),
	`to_status` varchar(30) NOT NULL,
	`changed_by` varchar(100),
	`note` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `work_order_transitions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `analytics_snapshots` MODIFY COLUMN `avgReviewRating` decimal(3,1);--> statement-breakpoint
ALTER TABLE `leads` MODIFY COLUMN `source` enum('popup','chat','booking','manual','callback','fleet','financing_preapproval') NOT NULL DEFAULT 'popup';--> statement-breakpoint
ALTER TABLE `work_orders` MODIFY COLUMN `status` varchar(30) NOT NULL DEFAULT 'draft';--> statement-breakpoint
ALTER TABLE `bookings` ADD `gclid` varchar(255);--> statement-breakpoint
ALTER TABLE `bookings` ADD `confirmedAt` timestamp;--> statement-breakpoint
ALTER TABLE `bookings` ADD `confirmationMethod` varchar(20);--> statement-breakpoint
ALTER TABLE `bookings` ADD `confirmationSentAt` timestamp;--> statement-breakpoint
ALTER TABLE `customers` ADD `totalSpent` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `customers` ADD `firstVisitDate` timestamp;--> statement-breakpoint
ALTER TABLE `customers` ADD `vehicleYear` varchar(10);--> statement-breakpoint
ALTER TABLE `customers` ADD `vehicleMake` varchar(50);--> statement-breakpoint
ALTER TABLE `customers` ADD `vehicleModel` varchar(50);--> statement-breakpoint
ALTER TABLE `customers` ADD `lastRetentionTier` int;--> statement-breakpoint
ALTER TABLE `customers` ADD `lastRetentionDate` timestamp;--> statement-breakpoint
ALTER TABLE `invoices` ADD `workOrderId` int;--> statement-breakpoint
ALTER TABLE `leads` ADD `estimatedValueCents` int;--> statement-breakpoint
ALTER TABLE `leads` ADD `lastFollowUpAt` timestamp;--> statement-breakpoint
ALTER TABLE `leads` ADD `gclid` varchar(255);--> statement-breakpoint
ALTER TABLE `technicians` ADD `role` varchar(20) DEFAULT 'mid';--> statement-breakpoint
ALTER TABLE `technicians` ADD `skills` json;--> statement-breakpoint
ALTER TABLE `technicians` ADD `ase_certs` json;--> statement-breakpoint
ALTER TABLE `technicians` ADD `clocked_in` boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE `technicians` ADD `clocked_in_at` timestamp;--> statement-breakpoint
ALTER TABLE `technicians` ADD `phone` varchar(30);--> statement-breakpoint
ALTER TABLE `technicians` ADD `avg_job_duration_ratio` decimal(5,2) DEFAULT '1.00';--> statement-breakpoint
ALTER TABLE `technicians` ADD `qc_pass_rate` decimal(5,2) DEFAULT '1.00';--> statement-breakpoint
ALTER TABLE `technicians` ADD `comeback_rate` decimal(5,2) DEFAULT '0.00';--> statement-breakpoint
ALTER TABLE `technicians` ADD `total_jobs_completed` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `technicians` ADD `tech_notes` text;--> statement-breakpoint
ALTER TABLE `work_order_items` ADD `labor_rate` decimal(8,2);--> statement-breakpoint
ALTER TABLE `work_order_items` ADD `labor_source` varchar(20);--> statement-breakpoint
ALTER TABLE `work_order_items` ADD `part_status` varchar(20) DEFAULT 'not_needed';--> statement-breakpoint
ALTER TABLE `work_order_items` ADD `part_ordered_at` timestamp;--> statement-breakpoint
ALTER TABLE `work_order_items` ADD `part_received_at` timestamp;--> statement-breakpoint
ALTER TABLE `work_order_items` ADD `part_eta` timestamp;--> statement-breakpoint
ALTER TABLE `work_order_items` ADD `supplier_name` varchar(100);--> statement-breakpoint
ALTER TABLE `work_order_items` ADD `supplier_order_ref` varchar(50);--> statement-breakpoint
ALTER TABLE `work_order_items` ADD `part_source` varchar(30);--> statement-breakpoint
ALTER TABLE `work_order_items` ADD `approved` boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE `work_order_items` ADD `declined` boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE `work_order_items` ADD `decline_reason` varchar(100);--> statement-breakpoint
ALTER TABLE `work_order_items` ADD `decline_outreach_at` timestamp;--> statement-breakpoint
ALTER TABLE `work_order_items` ADD `decline_outreach_method` varchar(64);--> statement-breakpoint
ALTER TABLE `work_order_items` ADD `decline_outreach_notes` text;--> statement-breakpoint
ALTER TABLE `work_order_items` ADD `decline_recovered_at` timestamp;--> statement-breakpoint
ALTER TABLE `work_order_items` ADD `completed` boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE `work_order_items` ADD `urgency` varchar(20);--> statement-breakpoint
ALTER TABLE `work_orders` ADD `assigned_tech_id` int;--> statement-breakpoint
ALTER TABLE `work_orders` ADD `assigned_advisor` varchar(100);--> statement-breakpoint
ALTER TABLE `work_orders` ADD `tech_notes` text;--> statement-breakpoint
ALTER TABLE `work_orders` ADD `vehicle_year` int;--> statement-breakpoint
ALTER TABLE `work_orders` ADD `vehicle_make` varchar(50);--> statement-breakpoint
ALTER TABLE `work_orders` ADD `vehicle_model` varchar(50);--> statement-breakpoint
ALTER TABLE `work_orders` ADD `vehicle_vin` varchar(20);--> statement-breakpoint
ALTER TABLE `work_orders` ADD `vehicle_mileage` int;--> statement-breakpoint
ALTER TABLE `work_orders` ADD `blocker_type` varchar(30);--> statement-breakpoint
ALTER TABLE `work_orders` ADD `blocker_note` text;--> statement-breakpoint
ALTER TABLE `work_orders` ADD `blocker_since` timestamp;--> statement-breakpoint
ALTER TABLE `work_orders` ADD `promised_at` timestamp;--> statement-breakpoint
ALTER TABLE `work_orders` ADD `started_at` timestamp;--> statement-breakpoint
ALTER TABLE `work_orders` ADD `completed_at` timestamp;--> statement-breakpoint
ALTER TABLE `work_orders` ADD `picked_up_at` timestamp;--> statement-breakpoint
ALTER TABLE `work_orders` ADD `quoted_total` decimal(10,2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE `work_orders` ADD `financing_used` boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE `work_orders` ADD `financing_provider` varchar(50);--> statement-breakpoint
ALTER TABLE `work_orders` ADD `estimate_id` int;--> statement-breakpoint
ALTER TABLE `work_orders` ADD `inspection_id` int;--> statement-breakpoint
ALTER TABLE `work_orders` ADD `has_declined_work` boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE `work_orders` ADD `declined_work_json` json;--> statement-breakpoint
ALTER TABLE `work_orders` ADD `service_description` text;--> statement-breakpoint
ALTER TABLE `bookings` ADD CONSTRAINT `idx_booking_ref` UNIQUE(`referenceCode`);--> statement-breakpoint
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_invoiceNumber_unique` UNIQUE(`invoiceNumber`);--> statement-breakpoint
CREATE INDEX `idx_chat_analytics_hour` ON `chat_analytics` (`hourOfDay`);--> statement-breakpoint
CREATE INDEX `idx_chat_analytics_day` ON `chat_analytics` (`dayOfWeek`);--> statement-breakpoint
CREATE INDEX `idx_chat_analytics_month` ON `chat_analytics` (`month`);--> statement-breakpoint
CREATE INDEX `idx_chat_analytics_session` ON `chat_analytics` (`sessionId`);--> statement-breakpoint
CREATE INDEX `idx_comeback_orig` ON `comebacks` (`original_work_order_id`);--> statement-breakpoint
CREATE INDEX `idx_comeback_customer` ON `comebacks` (`customer_id`);--> statement-breakpoint
CREATE INDEX `idx_memory_visitor` ON `conversation_memory` (`visitorKey`);--> statement-breakpoint
CREATE INDEX `idx_memory_category` ON `conversation_memory` (`category`);--> statement-breakpoint
CREATE INDEX `idx_csm_wo` ON `customer_status_messages` (`work_order_id`);--> statement-breakpoint
CREATE INDEX `idx_daily_date` ON `daily_execution` (`date`);--> statement-breakpoint
CREATE INDEX `idx_habit_date_key` ON `daily_habits` (`date`,`habit_key`);--> statement-breakpoint
CREATE INDEX `idx_estimate_phone` ON `estimates_log` (`phone`);--> statement-breakpoint
CREATE INDEX `idx_estimate_source` ON `estimates_log` (`source`);--> statement-breakpoint
CREATE INDEX `idx_estimate_created` ON `estimates_log` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_ig_analytics_post` ON `instagram_analytics` (`postId`);--> statement-breakpoint
CREATE INDEX `idx_ig_analytics_created` ON `instagram_analytics` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_pipeline_runs_name` ON `pipeline_runs` (`pipelineName`);--> statement-breakpoint
CREATE INDEX `idx_pipeline_runs_status` ON `pipeline_runs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_pipeline_runs_started` ON `pipeline_runs` (`startedAt`);--> statement-breakpoint
CREATE INDEX `idx_qc_wo` ON `qc_checklists` (`work_order_id`);--> statement-breakpoint
CREATE INDEX `idx_review_pipeline_rating` ON `review_pipeline` (`rating`);--> statement-breakpoint
CREATE INDEX `idx_review_pipeline_sentiment` ON `review_pipeline` (`sentiment`);--> statement-breakpoint
CREATE INDEX `idx_review_pipeline_reviewed` ON `review_pipeline` (`reviewed`);--> statement-breakpoint
CREATE INDEX `idx_review_trends_date` ON `review_trends` (`snapshotDate`);--> statement-breakpoint
CREATE INDEX `idx_search_perf_query` ON `search_performance` (`query`);--> statement-breakpoint
CREATE INDEX `idx_search_perf_date` ON `search_performance` (`date`);--> statement-breakpoint
CREATE INDEX `idx_search_perf_page` ON `search_performance` (`page`);--> statement-breakpoint
CREATE INDEX `idx_wot_work_order` ON `work_order_transitions` (`work_order_id`);--> statement-breakpoint
CREATE INDEX `idx_booking_phone` ON `bookings` (`phone`);--> statement-breakpoint
CREATE INDEX `idx_booking_status` ON `bookings` (`status`);--> statement-breakpoint
CREATE INDEX `idx_booking_created` ON `bookings` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_call_created` ON `call_events` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_call_source` ON `call_events` (`sourcePage`);--> statement-breakpoint
CREATE INDEX `idx_chat_lead` ON `chat_sessions` (`leadId`);--> statement-breakpoint
CREATE INDEX `idx_chat_created` ON `chat_sessions` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_vehicle_user` ON `customer_vehicles` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_customer_phone` ON `customers` (`phone`);--> statement-breakpoint
CREATE INDEX `idx_customer_segment` ON `customers` (`segment`);--> statement-breakpoint
CREATE INDEX `idx_customer_last_visit` ON `customers` (`lastVisitDate`);--> statement-breakpoint
CREATE INDEX `idx_customer_als_id` ON `customers` (`alsCustomerId`);--> statement-breakpoint
CREATE INDEX `idx_inspection_item_inspection` ON `inspection_items` (`inspectionId`);--> statement-breakpoint
CREATE INDEX `idx_invoice_booking` ON `invoices` (`bookingId`);--> statement-breakpoint
CREATE INDEX `idx_invoice_work_order` ON `invoices` (`workOrderId`);--> statement-breakpoint
CREATE INDEX `idx_invoice_customer` ON `invoices` (`customerName`);--> statement-breakpoint
CREATE INDEX `idx_invoice_date` ON `invoices` (`invoiceDate`);--> statement-breakpoint
CREATE INDEX `idx_invoice_payment_status` ON `invoices` (`paymentStatus`);--> statement-breakpoint
CREATE INDEX `idx_lead_phone` ON `leads` (`phone`);--> statement-breakpoint
CREATE INDEX `idx_lead_status` ON `leads` (`status`);--> statement-breakpoint
CREATE INDEX `idx_lead_source` ON `leads` (`source`);--> statement-breakpoint
CREATE INDEX `idx_lead_created` ON `leads` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_loyalty_tx_user` ON `loyalty_transactions` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_loyalty_tx_type` ON `loyalty_transactions` (`type`);--> statement-breakpoint
CREATE INDEX `idx_portal_phone` ON `portal_sessions` (`phone`);--> statement-breakpoint
CREATE INDEX `idx_portal_token` ON `portal_sessions` (`sessionToken`);--> statement-breakpoint
CREATE INDEX `idx_review_booking` ON `review_requests` (`bookingId`);--> statement-breakpoint
CREATE INDEX `idx_review_phone` ON `review_requests` (`phone`);--> statement-breakpoint
CREATE INDEX `idx_review_status` ON `review_requests` (`status`);--> statement-breakpoint
CREATE INDEX `idx_review_scheduled` ON `review_requests` (`scheduledAt`);--> statement-breakpoint
CREATE INDEX `idx_service_user` ON `service_history` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_service_vehicle` ON `service_history` (`vehicleId`);--> statement-breakpoint
CREATE INDEX `idx_service_booking` ON `service_history` (`bookingId`);--> statement-breakpoint
CREATE INDEX `idx_service_completed` ON `service_history` (`completedAt`);--> statement-breakpoint
CREATE INDEX `idx_campaign_send_cid` ON `sms_campaign_sends` (`campaignId`);--> statement-breakpoint
CREATE INDEX `idx_campaign_send_status` ON `sms_campaign_sends` (`status`);--> statement-breakpoint
CREATE INDEX `idx_sms_msg_conv` ON `sms_messages` (`conversationId`);--> statement-breakpoint
CREATE INDEX `idx_sms_msg_created` ON `sms_messages` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_sms_msg_status_created` ON `sms_messages` (`status`,`createdAt`);