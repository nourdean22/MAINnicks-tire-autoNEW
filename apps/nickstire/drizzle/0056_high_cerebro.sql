CREATE TABLE `sms_orchestrations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`event_type` varchar(100) NOT NULL,
	`customer_phone` varchar(30) NOT NULL,
	`message_body` text NOT NULL,
	`variant_key` varchar(50) NOT NULL,
	`should_auto_send` boolean NOT NULL,
	`requires_human_approval` boolean NOT NULL,
	`reason` text,
	`customer_context` text,
	`provider_used` varchar(50) NOT NULL,
	`cooldown_key` varchar(255),
	`status` varchar(50) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `sms_orchestrations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_sms_orch_phone` ON `sms_orchestrations` (`customer_phone`);--> statement-breakpoint
CREATE INDEX `idx_sms_orch_created` ON `sms_orchestrations` (`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_sms_orch_event` ON `sms_orchestrations` (`event_type`);--> statement-breakpoint
CREATE INDEX `idx_sms_orch_cooldown` ON `sms_orchestrations` (`cooldown_key`);