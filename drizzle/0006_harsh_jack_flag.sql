CREATE TABLE `callback_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`phone` varchar(30) NOT NULL,
	`context` text,
	`sourcePage` varchar(255),
	`status` enum('new','called','no-answer','completed') NOT NULL DEFAULT 'new',
	`calledAt` timestamp,
	`calledBy` varchar(255),
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `callback_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `inspection_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`inspectionId` int NOT NULL,
	`component` varchar(255) NOT NULL,
	`category` enum('brakes','tires','engine','suspension','electrical','fluids','body','other') NOT NULL,
	`condition` enum('green','yellow','red') NOT NULL,
	`notes` text,
	`photoUrl` varchar(1000),
	`recommendedAction` text,
	`estimatedCost` int,
	`sortOrder` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `inspection_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `loyalty_rewards` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text NOT NULL,
	`pointsCost` int NOT NULL,
	`rewardValue` int NOT NULL,
	`rewardType` enum('dollar-off','percent-off','free-service') NOT NULL DEFAULT 'dollar-off',
	`applicableService` varchar(100) NOT NULL DEFAULT 'all',
	`isActive` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `loyalty_rewards_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `loyalty_transactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`type` enum('earn','redeem','bonus','adjustment') NOT NULL,
	`points` int NOT NULL,
	`balanceAfter` int NOT NULL,
	`description` varchar(500) NOT NULL,
	`serviceHistoryId` int,
	`rewardId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `loyalty_transactions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `service_pricing` (
	`id` int AUTO_INCREMENT NOT NULL,
	`serviceType` varchar(100) NOT NULL,
	`serviceLabel` varchar(255) NOT NULL,
	`vehicleCategory` enum('compact','midsize','full-size','truck-suv') NOT NULL,
	`lowEstimate` int NOT NULL,
	`highEstimate` int NOT NULL,
	`typicalHours` varchar(20),
	`notes` text,
	`isActive` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `service_pricing_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `vehicle_inspections` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int,
	`customerName` varchar(255) NOT NULL,
	`customerPhone` varchar(30),
	`customerEmail` varchar(320),
	`vehicleInfo` varchar(255) NOT NULL,
	`vehicleYear` varchar(10),
	`vehicleMake` varchar(50),
	`vehicleModel` varchar(50),
	`mileage` int,
	`technicianName` varchar(255) NOT NULL,
	`overallCondition` enum('good','fair','needs-attention') NOT NULL DEFAULT 'fair',
	`summaryNotes` text,
	`shareToken` varchar(64) NOT NULL,
	`isPublished` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `vehicle_inspections_id` PRIMARY KEY(`id`),
	CONSTRAINT `vehicle_inspections_shareToken_unique` UNIQUE(`shareToken`)
);
--> statement-breakpoint
ALTER TABLE `customer_notifications` MODIFY COLUMN `notificationType` enum('booking_confirmed','booking_inprogress','booking_completed','follow_up','review_request','maintenance_reminder','special_offer','status_update') NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` MODIFY COLUMN `source` enum('popup','chat','booking','manual','callback','fleet') NOT NULL DEFAULT 'popup';--> statement-breakpoint
ALTER TABLE `bookings` ADD `urgency` enum('emergency','this-week','whenever') DEFAULT 'whenever' NOT NULL;--> statement-breakpoint
ALTER TABLE `bookings` ADD `stage` enum('received','inspecting','waiting-parts','in-progress','quality-check','ready') DEFAULT 'received' NOT NULL;--> statement-breakpoint
ALTER TABLE `bookings` ADD `stageUpdatedAt` timestamp DEFAULT (now()) NOT NULL;--> statement-breakpoint
ALTER TABLE `bookings` ADD `referenceCode` varchar(20);--> statement-breakpoint
ALTER TABLE `bookings` ADD `followUp24hSent` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `bookings` ADD `followUp7dSent` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `leads` ADD `companyName` varchar(255);--> statement-breakpoint
ALTER TABLE `leads` ADD `fleetSize` int;--> statement-breakpoint
ALTER TABLE `leads` ADD `vehicleTypes` text;--> statement-breakpoint
ALTER TABLE `service_history` ADD `pointsEarned` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `loyaltyPoints` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `loyaltyTier` enum('bronze','silver','gold','platinum') DEFAULT 'bronze' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `totalVisits` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `totalSpent` int DEFAULT 0 NOT NULL;