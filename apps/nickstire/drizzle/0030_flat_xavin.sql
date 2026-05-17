-- 2026-05-06 · customer_events table for generic visual-surface event
-- logging (PhotoRibbon photo views, Hold-A-Bay clicks, scroll-depth
-- milestones, future trackEvent() calls).
--
-- Pairs with the existing call_events table — that one is phone-only;
-- this is everything else. Indexed on (eventName, createdAt) so the
-- admin TrafficFunnelSection summary query stays fast at 10K+ events/day.
--
-- NOTE: drizzle-kit's auto-generated migration also picked up
-- alg_estimates, alg_probe_log, gbp_post_log + a leads.source enum
-- modify — those are drift from prior migrations (0027-0029) that
-- predate the current journal.json baseline. Trimmed manually to
-- avoid "table already exists" failures on prod deploy.

CREATE TABLE IF NOT EXISTS `customer_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`eventName` varchar(64) NOT NULL,
	`eventData` json,
	`sourcePage` varchar(500),
	`utmSource` varchar(100),
	`utmMedium` varchar(100),
	`utmCampaign` varchar(255),
	`referrer` varchar(500),
	`userAgent` varchar(500),
	`sessionId` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `customer_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_customer_events_name_date` ON `customer_events` (`eventName`,`createdAt`);
--> statement-breakpoint
CREATE INDEX `idx_customer_events_date` ON `customer_events` (`createdAt`);
--> statement-breakpoint
CREATE INDEX `idx_customer_events_session` ON `customer_events` (`sessionId`);
