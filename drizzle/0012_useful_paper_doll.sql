CREATE TABLE `customer_import_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`totalRows` int NOT NULL DEFAULT 0,
	`newCustomers` int NOT NULL DEFAULT 0,
	`updatedCustomers` int NOT NULL DEFAULT 0,
	`skippedRows` int NOT NULL DEFAULT 0,
	`source` varchar(100) NOT NULL DEFAULT 'shopdriver_csv',
	`status` enum('processing','completed','failed') NOT NULL DEFAULT 'processing',
	`errorMessage` text,
	`importedBy` varchar(100) NOT NULL DEFAULT 'admin',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `customer_import_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `shop_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`key` varchar(100) NOT NULL,
	`value` text NOT NULL,
	`label` varchar(255),
	`category` enum('pricing','contact','hours','sms','general') NOT NULL DEFAULT 'general',
	`updatedBy` varchar(100) NOT NULL DEFAULT 'system',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `shop_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `shop_settings_key_unique` UNIQUE(`key`)
);
