CREATE TABLE `review_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int NOT NULL,
	`customerName` varchar(255) NOT NULL,
	`phone` varchar(30) NOT NULL,
	`service` varchar(100),
	`status` enum('pending','sent','clicked','failed','skipped') NOT NULL DEFAULT 'pending',
	`scheduledAt` timestamp NOT NULL,
	`sentAt` timestamp,
	`clickedAt` timestamp,
	`trackingToken` varchar(64) NOT NULL,
	`errorMessage` text,
	`twilioSid` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `review_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `review_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`enabled` int NOT NULL DEFAULT 1,
	`delayMinutes` int NOT NULL DEFAULT 120,
	`maxPerDay` int NOT NULL DEFAULT 20,
	`cooldownDays` int NOT NULL DEFAULT 30,
	`messageTemplate` text,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `review_settings_id` PRIMARY KEY(`id`)
);
