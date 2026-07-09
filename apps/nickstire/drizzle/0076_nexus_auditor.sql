CREATE TABLE `nexus_audit_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`jobType` varchar(100) NOT NULL,
	`status` enum('pending','processing','completed','failed') NOT NULL DEFAULT 'pending',
	`priority` int NOT NULL DEFAULT 0,
	`sourceTable` varchar(100) NOT NULL,
	`sourceId` varchar(100) NOT NULL,
	`orchestrationId` varchar(100),
	`nickgptDraftId` int,
	`correlationId` varchar(100),
	`idempotencyKey` varchar(100),
	`reasonCode` varchar(100),
	`riskTier` varchar(50),
	`sampleReason` varchar(255),
	`attempts` int NOT NULL DEFAULT 0,
	`maxAttempts` int NOT NULL DEFAULT 3,
	`nextRunAt` timestamp NOT NULL DEFAULT (now()),
	`startedAt` timestamp,
	`completedAt` timestamp,
	`lastError` text,
	`payloadJson` text,
	`resultJson` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `nexus_audit_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `nickgpt_defect_ledger` (
	`id` int AUTO_INCREMENT NOT NULL,
	`auditJobId` int,
	`orchestrationId` varchar(100),
	`nickgptDraftId` int,
	`phoneHashOrLast4` varchar(64) NOT NULL,
	`eventType` varchar(100),
	`variantKey` varchar(100),
	`templateKey` varchar(100),
	`intent` varchar(100),
	`confidence` float,
	`provider` varchar(100),
	`autoSent` int NOT NULL DEFAULT 0,
	`releaseDecision` varchar(100) NOT NULL,
	`severity` varchar(50) NOT NULL,
	`defectCodesJson` text,
	`findingsJson` text,
	`evidenceLedgerJson` text,
	`diagnosticBreakdownJson` text,
	`recommendedFixJson` text,
	`sanitizedTraceJson` text,
	`operatorReviewed` int NOT NULL DEFAULT 0,
	`operatorDisposition` varchar(100),
	`exportedToTraining` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`reviewedAt` timestamp,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `nickgpt_defect_ledger_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_nexus_job_status` ON `nexus_audit_jobs` (`status`,`nextRunAt`);--> statement-breakpoint
CREATE INDEX `idx_nexus_job_orchestration` ON `nexus_audit_jobs` (`orchestrationId`);--> statement-breakpoint
CREATE INDEX `idx_nexus_job_draft` ON `nexus_audit_jobs` (`nickgptDraftId`);--> statement-breakpoint
CREATE INDEX `idx_nexus_job_correlation` ON `nexus_audit_jobs` (`correlationId`);--> statement-breakpoint
CREATE INDEX `idx_nexus_job_sample` ON `nexus_audit_jobs` (`sampleReason`);--> statement-breakpoint
CREATE INDEX `idx_nexus_job_created` ON `nexus_audit_jobs` (`createdAt`);--> statement-breakpoint
ALTER TABLE `nickgpt_defect_ledger` ADD CONSTRAINT `nickgpt_defect_ledger_auditJobId_nexus_audit_jobs_id_fk` FOREIGN KEY (`auditJobId`) REFERENCES `nexus_audit_jobs`(`id`) ON DELETE set null ON UPDATE no action;
