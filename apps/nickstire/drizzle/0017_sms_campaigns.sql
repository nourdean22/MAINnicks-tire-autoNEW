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
CREATE INDEX `idx_sms_campaigns_status` ON `sms_campaigns` (`status`, `createdAt`);
--> statement-breakpoint
CREATE INDEX `idx_sms_campaigns_segment` ON `sms_campaigns` (`segment`);
--> statement-breakpoint
CREATE INDEX `idx_sms_campaign_sends_campaign` ON `sms_campaign_sends` (`campaignId`, `status`);
--> statement-breakpoint
CREATE INDEX `idx_sms_campaign_sends_customer` ON `sms_campaign_sends` (`customerId`, `campaignId`);
--> statement-breakpoint
CREATE INDEX `idx_sms_campaign_sends_status` ON `sms_campaign_sends` (`status`, `sentAt`);
