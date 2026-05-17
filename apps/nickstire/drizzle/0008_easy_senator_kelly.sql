CREATE TABLE `reminder_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`serviceType` varchar(100) NOT NULL,
	`serviceLabel` varchar(255) NOT NULL,
	`intervalMonths` int NOT NULL,
	`intervalMiles` int NOT NULL DEFAULT 0,
	`enabled` int NOT NULL DEFAULT 1,
	`messageTemplate` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `reminder_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `reminder_settings_serviceType_unique` UNIQUE(`serviceType`)
);
--> statement-breakpoint
CREATE TABLE `repair_gallery` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text,
	`beforeImageUrl` varchar(1000) NOT NULL,
	`afterImageUrl` varchar(1000) NOT NULL,
	`serviceType` varchar(100) NOT NULL,
	`vehicleInfo` varchar(255),
	`isPublished` int NOT NULL DEFAULT 1,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `repair_gallery_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `service_reminders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`vehicleId` int,
	`bookingId` int,
	`customerName` varchar(255) NOT NULL,
	`phone` varchar(30) NOT NULL,
	`vehicleInfo` varchar(255),
	`serviceType` varchar(100) NOT NULL,
	`lastServiceDate` timestamp NOT NULL,
	`lastServiceMileage` int,
	`nextDueDate` timestamp NOT NULL,
	`nextDueMileage` int,
	`status` enum('scheduled','sent','snoozed','completed','cancelled') NOT NULL DEFAULT 'scheduled',
	`sentAt` timestamp,
	`twilioSid` varchar(64),
	`errorMessage` text,
	`snoozedUntil` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `service_reminders_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sms_conversations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`phone` varchar(30) NOT NULL,
	`customerName` varchar(255),
	`bookingId` int,
	`status` enum('active','closed','archived') NOT NULL DEFAULT 'active',
	`unreadCount` int NOT NULL DEFAULT 0,
	`lastMessageAt` timestamp NOT NULL DEFAULT (now()),
	`lastMessagePreview` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `sms_conversations_id` PRIMARY KEY(`id`),
	CONSTRAINT `sms_conversations_phone_unique` UNIQUE(`phone`)
);
--> statement-breakpoint
CREATE TABLE `sms_messages` (
	`id` int AUTO_INCREMENT NOT NULL,
	`conversationId` int NOT NULL,
	`direction` enum('inbound','outbound') NOT NULL,
	`body` text NOT NULL,
	`twilioSid` varchar(64),
	`status` enum('queued','sent','delivered','failed','received') NOT NULL DEFAULT 'queued',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sms_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `technicians` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`title` varchar(255) NOT NULL,
	`bio` text,
	`specialties` text,
	`yearsExperience` int NOT NULL DEFAULT 0,
	`certifications` text,
	`photoUrl` varchar(1000),
	`isActive` int NOT NULL DEFAULT 1,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `technicians_id` PRIMARY KEY(`id`)
);
