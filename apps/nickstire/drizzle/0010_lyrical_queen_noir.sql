CREATE TABLE `winback_campaigns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`targetSegment` enum('lapsed','unknown','recent') NOT NULL,
	`targetCount` int NOT NULL DEFAULT 0,
	`sentCount` int NOT NULL DEFAULT 0,
	`status` enum('draft','active','paused','completed') NOT NULL DEFAULT 'draft',
	`activatedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `winback_campaigns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `winback_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`campaignId` int NOT NULL,
	`step` int NOT NULL,
	`delayDays` int NOT NULL DEFAULT 0,
	`body` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `winback_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `winback_sends` (
	`id` int AUTO_INCREMENT NOT NULL,
	`campaignId` int NOT NULL,
	`customerId` int NOT NULL,
	`messageId` int NOT NULL,
	`step` int NOT NULL,
	`phone` varchar(30) NOT NULL,
	`personalizedBody` text NOT NULL,
	`scheduledAt` timestamp NOT NULL,
	`sentAt` timestamp,
	`status` enum('pending','sent','failed') NOT NULL DEFAULT 'pending',
	`twilioSid` varchar(100),
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `winback_sends_id` PRIMARY KEY(`id`)
);
