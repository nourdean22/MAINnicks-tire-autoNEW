ALTER TABLE `bookings` ADD `vehicleYear` varchar(10);--> statement-breakpoint
ALTER TABLE `bookings` ADD `vehicleMake` varchar(50);--> statement-breakpoint
ALTER TABLE `bookings` ADD `vehicleModel` varchar(50);--> statement-breakpoint
ALTER TABLE `bookings` ADD `photoUrls` text;--> statement-breakpoint
ALTER TABLE `bookings` ADD `adminNotes` text;--> statement-breakpoint
ALTER TABLE `bookings` ADD `priority` int DEFAULT 0 NOT NULL;