-- ALG Probe Log — demand-driven probe scheduler
--
-- Replaces pulse-tier cron probing with explicit triggers:
--   admin_login | chat_query | manual_refresh | overnight | health_check
--
-- Solves the "Moe gets kicked from ShopDriver every 5 min" problem by
-- only firing probes when there's a real reason (not just because admin
-- has a tab open).

CREATE TABLE `alg_probe_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reason` varchar(32) NOT NULL,
	`detail` varchar(200),
	`outcome` varchar(32) NOT NULL,
	`recordsProcessed` int NOT NULL DEFAULT 0,
	`durationMs` int NOT NULL DEFAULT 0,
	`errorMessage` text,
	`startedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	`completedAt` timestamp NULL,
	CONSTRAINT `alg_probe_log_id` PRIMARY KEY(`id`)
);

CREATE INDEX `idx_alg_probe_log_started` ON `alg_probe_log` (`startedAt`);
CREATE INDEX `idx_alg_probe_log_reason` ON `alg_probe_log` (`reason`);
CREATE INDEX `idx_alg_probe_log_outcome` ON `alg_probe_log` (`outcome`);
