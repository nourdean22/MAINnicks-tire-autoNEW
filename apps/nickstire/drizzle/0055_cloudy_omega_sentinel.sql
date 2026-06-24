CREATE TABLE `customer_testimonials` (
	`id` int AUTO_INCREMENT NOT NULL,
	`author` varchar(100),
	`text` text NOT NULL,
	`rating` int NOT NULL DEFAULT 5,
	`source` varchar(50) NOT NULL DEFAULT 'manual',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customer_testimonials_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `nickgpt_drafts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`customer_phone` varchar(30) NOT NULL,
	`inbound_message` text NOT NULL,
	`draft_reply` text NOT NULL,
	`operator_reply` text,
	`intent` varchar(100),
	`confidence` float,
	`provider` varchar(50) NOT NULL,
	`latency_ms` int,
	`rating` enum('good','bad'),
	`status` enum('draft','approved','edited','rejected') NOT NULL DEFAULT 'draft',
	`auto_sent` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `nickgpt_drafts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reel_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`briefId` varchar(64) NOT NULL,
	`payload` text NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'queued',
	`clipUrlsJson` text,
	`voUrl` varchar(1000),
	`musicUrl` varchar(1000),
	`mp4Url` varchar(1000),
	`igPostId` varchar(64),
	`caption` text,
	`attempts` int NOT NULL DEFAULT 0,
	`error` varchar(1000),
	`source` varchar(16) NOT NULL DEFAULT 'admin',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `reel_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scheduled_posts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`platforms` json NOT NULL,
	`caption` text NOT NULL,
	`imageUrl` varchar(1000),
	`videoUrl` varchar(1000),
	`imageUrls` json,
	`scheduledAt` timestamp NOT NULL,
	`status` varchar(16) NOT NULL DEFAULT 'pending',
	`postedAt` timestamp,
	`igPostId` varchar(64),
	`error` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scheduled_posts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `social_drafts` (
	`id` varchar(64) NOT NULL,
	`contentType` varchar(16) NOT NULL,
	`topic` varchar(255) NOT NULL,
	`briefJson` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `social_drafts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `ig_autopost_log` ADD `promptVersion` varchar(32);--> statement-breakpoint
ALTER TABLE `instagram_analytics` ADD `reach` int;--> statement-breakpoint
ALTER TABLE `instagram_analytics` ADD `saved` int;--> statement-breakpoint
ALTER TABLE `instagram_analytics` ADD `views` int;--> statement-breakpoint
ALTER TABLE `instagram_analytics` ADD `shares` int;--> statement-breakpoint
ALTER TABLE `invoices` ADD `paymentReminder7dAttemptedAt` timestamp;--> statement-breakpoint
ALTER TABLE `invoices` ADD `paymentReminder7dSentAt` timestamp;--> statement-breakpoint
ALTER TABLE `invoices` ADD `paymentReminder30dAttemptedAt` timestamp;--> statement-breakpoint
ALTER TABLE `invoices` ADD `paymentReminder30dSentAt` timestamp;--> statement-breakpoint
CREATE INDEX `idx_testimonials_rating` ON `customer_testimonials` (`rating`);--> statement-breakpoint
CREATE INDEX `idx_nickgpt_drafts_phone` ON `nickgpt_drafts` (`customer_phone`);--> statement-breakpoint
CREATE INDEX `idx_nickgpt_drafts_created` ON `nickgpt_drafts` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_reel_jobs_status` ON `reel_jobs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_reel_jobs_created` ON `reel_jobs` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_scheduled_due` ON `scheduled_posts` (`status`,`scheduledAt`);--> statement-breakpoint
CREATE INDEX `idx_social_drafts_type` ON `social_drafts` (`contentType`);--> statement-breakpoint
CREATE INDEX `idx_social_drafts_created` ON `social_drafts` (`createdAt`);