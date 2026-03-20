CREATE TABLE `customer_metrics` (
	`id` int AUTO_INCREMENT NOT NULL,
	`customerId` int NOT NULL,
	`totalRevenue` int NOT NULL DEFAULT 0,
	`totalJobs` int NOT NULL DEFAULT 0,
	`avgSpendPerVisit` int NOT NULL DEFAULT 0,
	`daysSinceLastVisit` int,
	`churnRisk` enum('low','medium','high') NOT NULL DEFAULT 'low',
	`isVip` int NOT NULL DEFAULT 0,
	`predictedNextVisit` timestamp,
	`computedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `customer_metrics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` int AUTO_INCREMENT NOT NULL,
	`customerId` int,
	`bookingId` int,
	`customerName` varchar(255) NOT NULL,
	`customerPhone` varchar(30),
	`invoiceNumber` varchar(50),
	`totalAmount` int NOT NULL DEFAULT 0,
	`partsCost` int NOT NULL DEFAULT 0,
	`laborCost` int NOT NULL DEFAULT 0,
	`taxAmount` int NOT NULL DEFAULT 0,
	`serviceDescription` text,
	`vehicleInfo` varchar(255),
	`paymentMethod` enum('cash','card','check','financing','other') NOT NULL DEFAULT 'card',
	`paymentStatus` enum('paid','pending','partial','refunded') NOT NULL DEFAULT 'paid',
	`invoiceDate` timestamp NOT NULL DEFAULT (now()),
	`source` enum('shopdriver','manual','stripe') NOT NULL DEFAULT 'manual',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `invoices_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `job_assignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`bookingId` int NOT NULL,
	`technicianId` int NOT NULL,
	`estimatedHours` varchar(10),
	`startedAt` timestamp,
	`completedAt` timestamp,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `job_assignments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `kpi_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`weekStart` varchar(10) NOT NULL,
	`revenue` int NOT NULL DEFAULT 0,
	`jobsCompleted` int NOT NULL DEFAULT 0,
	`newCustomers` int NOT NULL DEFAULT 0,
	`avgTicket` int NOT NULL DEFAULT 0,
	`conversionRate` int NOT NULL DEFAULT 0,
	`satisfactionScore` int NOT NULL DEFAULT 0,
	`reviewsSent` int NOT NULL DEFAULT 0,
	`reviewsReceived` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `kpi_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `portal_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`phone` varchar(30) NOT NULL,
	`customerId` int,
	`verificationCode` varchar(10) NOT NULL,
	`sessionToken` varchar(128),
	`verified` int NOT NULL DEFAULT 0,
	`codeExpiresAt` timestamp NOT NULL,
	`sessionExpiresAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `portal_sessions_id` PRIMARY KEY(`id`)
);
