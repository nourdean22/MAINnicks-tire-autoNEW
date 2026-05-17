CREATE TABLE `content_generation_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`contentType` enum('article','notification','tip') NOT NULL,
	`contentId` int,
	`prompt` text,
	`status` enum('success','failed') NOT NULL DEFAULT 'success',
	`errorMessage` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `content_generation_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dynamic_articles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(255) NOT NULL,
	`title` varchar(500) NOT NULL,
	`metaTitle` varchar(255) NOT NULL,
	`metaDescription` varchar(200) NOT NULL,
	`category` varchar(100) NOT NULL,
	`readTime` varchar(20) NOT NULL,
	`heroImage` varchar(1000) NOT NULL,
	`excerpt` text NOT NULL,
	`sectionsJson` text NOT NULL,
	`relatedServicesJson` text NOT NULL,
	`tagsJson` text NOT NULL,
	`status` enum('draft','published','rejected') NOT NULL DEFAULT 'draft',
	`generatedBy` enum('ai','manual') NOT NULL DEFAULT 'ai',
	`publishDate` varchar(30) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dynamic_articles_id` PRIMARY KEY(`id`),
	CONSTRAINT `dynamic_articles_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `notification_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`message` text NOT NULL,
	`ctaText` varchar(100),
	`ctaHref` varchar(500),
	`icon` varchar(50) DEFAULT 'wrench',
	`season` enum('spring','summer','fall','winter','all') NOT NULL DEFAULT 'all',
	`isActive` int NOT NULL DEFAULT 1,
	`priority` int NOT NULL DEFAULT 0,
	`generatedBy` enum('ai','manual') NOT NULL DEFAULT 'ai',
	`startsAt` timestamp,
	`expiresAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `notification_messages_id` PRIMARY KEY(`id`)
);
