ALTER TABLE `search_performance` DROP KEY `uq_search_perf_date_query_page`;--> statement-breakpoint
ALTER TABLE `search_performance` ADD `device` varchar(20) DEFAULT 'desktop' NOT NULL;--> statement-breakpoint
ALTER TABLE `search_performance` ADD `country` varchar(10) DEFAULT 'usa' NOT NULL;--> statement-breakpoint
ALTER TABLE `search_performance` ADD `searchType` varchar(20) DEFAULT 'web' NOT NULL;--> statement-breakpoint
DELETE FROM `search_performance` WHERE `id` NOT IN (SELECT * FROM (SELECT MAX(`id`) FROM `search_performance` GROUP BY `date`, LEFT(`query`, 255), LEFT(`page`, 255), `device`, `country`, `searchType`) AS keepers);--> statement-breakpoint
ALTER TABLE `search_performance` ADD CONSTRAINT `uq_search_perf_date_query_page_device_country_type` UNIQUE(`date`,`query`(255),`page`(255),`device`,`country`,`searchType`);