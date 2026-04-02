-- Chat analytics: temporal pattern tracking for chat sessions
CREATE TABLE IF NOT EXISTS `chat_analytics` (
  `id` int AUTO_INCREMENT NOT NULL,
  `sessionId` int,
  `hourOfDay` int NOT NULL,
  `dayOfWeek` int NOT NULL,
  `month` int NOT NULL,
  `messageCount` int NOT NULL DEFAULT 0,
  `converted` int NOT NULL DEFAULT 0,
  `leadScore` int,
  `duration` int,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `chat_analytics_id` PRIMARY KEY(`id`)
);

CREATE INDEX `idx_chat_analytics_hour` ON `chat_analytics` (`hourOfDay`);
CREATE INDEX `idx_chat_analytics_day` ON `chat_analytics` (`dayOfWeek`);
CREATE INDEX `idx_chat_analytics_month` ON `chat_analytics` (`month`);
CREATE INDEX `idx_chat_analytics_session` ON `chat_analytics` (`sessionId`);

-- Review pipeline: GBP review analysis with AI sentiment and suggested responses
CREATE TABLE IF NOT EXISTS `review_pipeline` (
  `id` int AUTO_INCREMENT NOT NULL,
  `authorName` varchar(255) NOT NULL,
  `rating` int NOT NULL,
  `reviewText` text,
  `reviewTime` int,
  `relativeTime` varchar(100),
  `sentiment` varchar(20),
  `topicsJson` text,
  `suggestedResponse` text,
  `reviewed` int NOT NULL DEFAULT 0,
  `responseSent` int NOT NULL DEFAULT 0,
  `adminNotes` text,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `review_pipeline_id` PRIMARY KEY(`id`)
);

CREATE INDEX `idx_review_pipeline_rating` ON `review_pipeline` (`rating`);
CREATE INDEX `idx_review_pipeline_sentiment` ON `review_pipeline` (`sentiment`);
CREATE INDEX `idx_review_pipeline_reviewed` ON `review_pipeline` (`reviewed`);

-- Search performance: Google Search Console data
CREATE TABLE IF NOT EXISTS `search_performance` (
  `id` int AUTO_INCREMENT NOT NULL,
  `query` varchar(500) NOT NULL,
  `page` varchar(1000),
  `clicks` int NOT NULL DEFAULT 0,
  `impressions` int NOT NULL DEFAULT 0,
  `ctr` int NOT NULL DEFAULT 0,
  `position` int NOT NULL DEFAULT 0,
  `date` varchar(10) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `search_performance_id` PRIMARY KEY(`id`)
);

CREATE INDEX `idx_search_perf_query` ON `search_performance` (`query`);
CREATE INDEX `idx_search_perf_date` ON `search_performance` (`date`);
CREATE INDEX `idx_search_perf_page` ON `search_performance` (`page`(255));
