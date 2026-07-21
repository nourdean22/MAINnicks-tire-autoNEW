-- sms_response_jobs — the durable inbound-response obligation spine (NCSOS #1/#2).
--
-- Before this, an inbound customer text created a durable MESSAGE row
-- (sms_messages.status='received', deduped by provider MessageSid) but NOT a
-- durable OBLIGATION to respond. The reply was computed in-process during the
-- webhook request; a restart between persisting the message and finishing the
-- reply lost the obligation silently, and nothing ever re-scanned un-answered
-- inbounds. This is the exact "says it will do something then forgets" failure.
--
-- One row per inbound message. It leaves the queue only by reaching a terminal
-- status (responded / suppressed / failed / dead). The idempotencyKey is
-- deterministic so a provider redelivery dedupes to ONE obligation. See
-- server/services/smsResponseJobs.ts. This mirrors the handleRunMigrations
-- inline DDL; the two must stay identical.

CREATE TABLE IF NOT EXISTS `sms_response_jobs` (
  `id` int AUTO_INCREMENT NOT NULL,
  `conversationId` int NOT NULL,
  `customerPhone` varchar(30) NOT NULL,
  `providerMsgId` varchar(128) NULL,
  `idempotencyKey` varchar(191) NOT NULL,
  `body` text NOT NULL,
  `status` enum('pending','processing','responded','suppressed','failed','dead') NOT NULL DEFAULT 'pending',
  `attempts` int NOT NULL DEFAULT 0,
  `maxAttempts` int NOT NULL DEFAULT 5,
  `dueAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `claimedAt` timestamp NULL,
  `claimedBy` varchar(64) NULL,
  `orchestrationId` int NULL,
  `lastError` varchar(1000) NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `sms_response_jobs_id` PRIMARY KEY(`id`),
  CONSTRAINT `uniq_response_idem` UNIQUE(`idempotencyKey`)
);
--> statement-breakpoint
CREATE INDEX `idx_response_status_due` ON `sms_response_jobs` (`status`,`dueAt`);
--> statement-breakpoint
CREATE INDEX `idx_response_phone` ON `sms_response_jobs` (`customerPhone`);
