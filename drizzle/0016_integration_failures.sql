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
CREATE INDEX `idx_integration_failures_unresolved` ON `integration_failures` (`resolvedAt`, `createdAt`);
--> statement-breakpoint
CREATE INDEX `idx_integration_failures_entity` ON `integration_failures` (`entityType`, `entityId`);
--> statement-breakpoint
CREATE INDEX `idx_integration_failures_type` ON `integration_failures` (`failureType`, `createdAt`);
