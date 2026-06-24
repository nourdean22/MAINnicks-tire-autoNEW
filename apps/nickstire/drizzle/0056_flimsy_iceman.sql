CREATE TABLE `content_manufacturing_campaigns` (
	`id` varchar(64) NOT NULL,
	`topic` varchar(128) NOT NULL,
	`persona` varchar(64) NOT NULL,
	`target_monthly_volume` int NOT NULL DEFAULT 30,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `content_manufacturing_campaigns_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_campaign_topic` UNIQUE(`topic`)
);
--> statement-breakpoint
CREATE TABLE `intelligence_decision_ledger` (
	`id` int AUTO_INCREMENT NOT NULL,
	`engine_id` varchar(64) NOT NULL,
	`recommendation_type` varchar(64) NOT NULL,
	`recommendation_target` varchar(255) NOT NULL,
	`action_taken` varchar(64) NOT NULL,
	`value_at_risk_cents` int DEFAULT 0,
	`actual_revenue_captured_cents` int DEFAULT 0,
	`context_json` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `intelligence_decision_ledger_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `social_content_inventory` (
	`id` varchar(64) NOT NULL,
	`campaign_id` varchar(64),
	`content_type` enum('reel','carousel','post','story','poll') NOT NULL,
	`platform` enum('instagram','facebook','both') NOT NULL DEFAULT 'both',
	`topic` varchar(128) NOT NULL,
	`series_name` varchar(128) NOT NULL,
	`episode_number` int NOT NULL DEFAULT 1,
	`hook_category` varchar(64) NOT NULL,
	`hook_text` text NOT NULL,
	`body_text` text NOT NULL,
	`visual_style` varchar(64) NOT NULL,
	`persona` varchar(64) NOT NULL,
	`score_curiosity` int NOT NULL DEFAULT 0,
	`score_emotion` int NOT NULL DEFAULT 0,
	`score_shareability` int NOT NULL DEFAULT 0,
	`score_comment_potential` int NOT NULL DEFAULT 0,
	`score_save_potential` int NOT NULL DEFAULT 0,
	`score_local_relevance` int NOT NULL DEFAULT 0,
	`score_revenue_relevance` int NOT NULL DEFAULT 0,
	`score_authority` int NOT NULL DEFAULT 0,
	`score_hook_strength` int NOT NULL DEFAULT 0,
	`score_overall` int NOT NULL DEFAULT 0,
	`gsc_query_seed` varchar(255),
	`weather_trigger_condition` varchar(128),
	`interactive_dm_keyword` varchar(64),
	`metrics_reach` int DEFAULT 0,
	`metrics_engagement` int DEFAULT 0,
	`metrics_shares` int DEFAULT 0,
	`metrics_saves` int DEFAULT 0,
	`metrics_comments` int DEFAULT 0,
	`metrics_bookings_attributed` int DEFAULT 0,
	`status` varchar(32) NOT NULL DEFAULT 'pending',
	`scheduled_at` timestamp,
	`published_at` timestamp,
	`asset_paths` json,
	`brief_json` text,
	`error_message` varchar(500),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `social_content_inventory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_intel_engine` ON `intelligence_decision_ledger` (`engine_id`);--> statement-breakpoint
CREATE INDEX `idx_intel_action` ON `intelligence_decision_ledger` (`action_taken`);--> statement-breakpoint
CREATE INDEX `idx_intel_created` ON `intelligence_decision_ledger` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_sci_status_scheduled` ON `social_content_inventory` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `idx_sci_campaign` ON `social_content_inventory` (`campaign_id`);--> statement-breakpoint
CREATE INDEX `idx_sci_topic_type` ON `social_content_inventory` (`topic`,`content_type`);