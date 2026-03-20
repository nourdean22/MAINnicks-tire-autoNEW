CREATE TABLE `call_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`phoneNumber` varchar(30) NOT NULL,
	`sourcePage` varchar(500),
	`clickElement` varchar(100),
	`utmSource` varchar(100),
	`utmMedium` varchar(100),
	`utmCampaign` varchar(255),
	`landingPage` varchar(500),
	`referrer` varchar(500),
	`userAgent` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `call_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `bookings` ADD `utmSource` varchar(100);--> statement-breakpoint
ALTER TABLE `bookings` ADD `utmMedium` varchar(100);--> statement-breakpoint
ALTER TABLE `bookings` ADD `utmCampaign` varchar(255);--> statement-breakpoint
ALTER TABLE `bookings` ADD `utmTerm` varchar(255);--> statement-breakpoint
ALTER TABLE `bookings` ADD `utmContent` varchar(255);--> statement-breakpoint
ALTER TABLE `bookings` ADD `landingPage` varchar(500);--> statement-breakpoint
ALTER TABLE `bookings` ADD `referrer` varchar(500);--> statement-breakpoint
ALTER TABLE `callback_requests` ADD `utmSource` varchar(100);--> statement-breakpoint
ALTER TABLE `callback_requests` ADD `utmMedium` varchar(100);--> statement-breakpoint
ALTER TABLE `callback_requests` ADD `utmCampaign` varchar(255);--> statement-breakpoint
ALTER TABLE `callback_requests` ADD `landingPage` varchar(500);--> statement-breakpoint
ALTER TABLE `callback_requests` ADD `referrer` varchar(500);--> statement-breakpoint
ALTER TABLE `leads` ADD `utmSource` varchar(100);--> statement-breakpoint
ALTER TABLE `leads` ADD `utmMedium` varchar(100);--> statement-breakpoint
ALTER TABLE `leads` ADD `utmCampaign` varchar(255);--> statement-breakpoint
ALTER TABLE `leads` ADD `landingPage` varchar(500);--> statement-breakpoint
ALTER TABLE `leads` ADD `referrer` varchar(500);