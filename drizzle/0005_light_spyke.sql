CREATE TABLE `analytics_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`date` varchar(10) NOT NULL,
	`totalBookings` int NOT NULL DEFAULT 0,
	`completedBookings` int NOT NULL DEFAULT 0,
	`newLeads` int NOT NULL DEFAULT 0,
	`convertedLeads` int NOT NULL DEFAULT 0,
	`pageViews` int NOT NULL DEFAULT 0,
	`uniqueVisitors` int NOT NULL DEFAULT 0,
	`topService` varchar(100),
	`serviceBreakdownJson` text,
	`geoBreakdownJson` text,
	`avgReviewRating` int,
	`newReviewCount` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `analytics_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `coupons` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text NOT NULL,
	`discountType` enum('dollar','percent','free') NOT NULL DEFAULT 'dollar',
	`discountValue` int NOT NULL DEFAULT 0,
	`code` varchar(50),
	`applicableServices` varchar(500) NOT NULL DEFAULT 'all',
	`terms` text,
	`maxRedemptions` int NOT NULL DEFAULT 0,
	`currentRedemptions` int NOT NULL DEFAULT 0,
	`isActive` int NOT NULL DEFAULT 1,
	`isFeatured` int NOT NULL DEFAULT 0,
	`startsAt` timestamp NOT NULL DEFAULT (now()),
	`expiresAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `coupons_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `customer_notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int,
	`recipientName` varchar(255) NOT NULL,
	`recipientPhone` varchar(30),
	`recipientEmail` varchar(320),
	`notificationType` enum('booking_confirmed','booking_inprogress','booking_completed','follow_up','review_request','maintenance_reminder','special_offer') NOT NULL,
	`subject` varchar(255),
	`message` text NOT NULL,
	`status` enum('pending','sent','failed') NOT NULL DEFAULT 'pending',
	`sentAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `customer_notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `customer_vehicles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`year` varchar(10) NOT NULL,
	`make` varchar(50) NOT NULL,
	`model` varchar(50) NOT NULL,
	`mileage` int,
	`nickname` varchar(100),
	`vin` varchar(20),
	`lastServiceDate` timestamp,
	`lastServiceMileage` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customer_vehicles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `mechanic_qa` (
	`id` int AUTO_INCREMENT NOT NULL,
	`questionerName` varchar(255) NOT NULL,
	`questionerEmail` varchar(320),
	`question` text NOT NULL,
	`vehicleInfo` varchar(255),
	`answer` text,
	`answeredBy` varchar(255),
	`isPublished` int NOT NULL DEFAULT 0,
	`isFeatured` int NOT NULL DEFAULT 0,
	`category` varchar(100),
	`upvotes` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `mechanic_qa_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `referrals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`referrerName` varchar(255) NOT NULL,
	`referrerPhone` varchar(30) NOT NULL,
	`referrerEmail` varchar(320),
	`refereeName` varchar(255) NOT NULL,
	`refereePhone` varchar(30) NOT NULL,
	`refereeEmail` varchar(320),
	`status` enum('pending','visited','redeemed','expired') NOT NULL DEFAULT 'pending',
	`referrerRewardRedeemed` int NOT NULL DEFAULT 0,
	`refereeRewardRedeemed` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `referrals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `service_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`vehicleId` int,
	`bookingId` int,
	`serviceType` varchar(100) NOT NULL,
	`description` text,
	`mileageAtService` int,
	`cost` int,
	`technicianNotes` text,
	`completedAt` timestamp NOT NULL DEFAULT (now()),
	`nextServiceDue` timestamp,
	`nextServiceMileage` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `service_history_id` PRIMARY KEY(`id`)
);
