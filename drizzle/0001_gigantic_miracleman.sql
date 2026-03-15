CREATE TABLE `bookings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`phone` varchar(30) NOT NULL,
	`email` varchar(320),
	`service` varchar(100) NOT NULL,
	`vehicle` varchar(255),
	`preferredDate` varchar(30),
	`preferredTime` enum('morning','afternoon','no-preference') NOT NULL DEFAULT 'no-preference',
	`message` text,
	`status` enum('new','confirmed','completed','cancelled') NOT NULL DEFAULT 'new',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bookings_id` PRIMARY KEY(`id`)
);
