-- GBP Post Log — sent-history for Google Business Profile posts
--
-- Replaces the in-memory variety guard (which lost state on every deploy)
-- with a durable table. Generator reads recent rows to avoid repeating
-- archetypes/topics, then writes a row after each successful generation.
--
-- Indexes:
--   · idx_gbp_post_log_posted     → cron pulls "last 14 days" by date
--   · idx_gbp_post_log_archetype  → variety check ("how many proof posts in last N?")
--   · idx_gbp_post_log_topic      → dedup check (skip if same topicHash recently)

CREATE TABLE `gbp_post_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`archetype` varchar(20) NOT NULL,
	`topicHash` varchar(64) NOT NULL,
	`postBody` text NOT NULL,
	`ctaType` varchar(20) NOT NULL,
	`ctaUrl` varchar(500) NOT NULL,
	`imageHint` text,
	`source` varchar(20) NOT NULL DEFAULT 'cron',
	`postedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `gbp_post_log_id` PRIMARY KEY(`id`)
);

CREATE INDEX `idx_gbp_post_log_posted` ON `gbp_post_log` (`postedAt`);
CREATE INDEX `idx_gbp_post_log_archetype` ON `gbp_post_log` (`archetype`);
CREATE INDEX `idx_gbp_post_log_topic` ON `gbp_post_log` (`topicHash`);
