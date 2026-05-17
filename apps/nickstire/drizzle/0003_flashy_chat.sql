CREATE TABLE `chat_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`leadId` int,
	`messagesJson` text NOT NULL,
	`vehicleInfo` varchar(255),
	`problemSummary` text,
	`converted` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `chat_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `leads` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`phone` varchar(30) NOT NULL,
	`email` varchar(320),
	`vehicle` varchar(255),
	`problem` text,
	`source` enum('popup','chat','booking','manual') NOT NULL DEFAULT 'popup',
	`urgencyScore` int NOT NULL DEFAULT 3,
	`urgencyReason` text,
	`recommendedService` varchar(100),
	`contacted` int NOT NULL DEFAULT 0,
	`contactedAt` timestamp,
	`contactedBy` varchar(255),
	`contactNotes` text,
	`sheetSynced` int NOT NULL DEFAULT 0,
	`sheetRow` int,
	`status` enum('new','contacted','booked','closed','lost') NOT NULL DEFAULT 'new',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `leads_id` PRIMARY KEY(`id`)
);
