-- 0106: IG-037 media_product_type + Wave C append-only metric snapshots.
-- TiDB: ONE schema change per ALTER (combined clauses throw). Both statements
-- additive; hand-applied via scripts/apply-0106-ig-insights.mts (the runner
-- marks tracked without executing — the 0083-0087 trap).
ALTER TABLE `instagram_analytics` ADD COLUMN `mediaProductType` varchar(32) NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ig_metric_snapshots` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `postId` varchar(100) NOT NULL,
  `capturedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `likes` int NOT NULL DEFAULT 0,
  `comments` int NOT NULL DEFAULT 0,
  `reach` int NULL,
  `saved` int NULL,
  `views` int NULL,
  `shares` int NULL,
  `followerSnapshot` int NULL,
  KEY `idx_ig_snap_post` (`postId`),
  KEY `idx_ig_snap_captured` (`capturedAt`)
);
