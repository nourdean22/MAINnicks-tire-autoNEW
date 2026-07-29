-- 0107: Pattern Lab store (Wave C′ final item). One additive CREATE, no
-- destructive statements; hand-applied via scripts/apply-0107-reel-patterns.mts
-- (the runner marks tracked without executing — the 0083-0087 trap).
CREATE TABLE IF NOT EXISTS `social_reel_patterns` (
  `id` varchar(64) PRIMARY KEY,
  `label` varchar(80) NOT NULL,
  `hookType` varchar(32) NOT NULL,
  `loopType` varchar(32) NOT NULL,
  `patternJson` text NOT NULL,
  `timesUsed` int NOT NULL DEFAULT 0,
  `lastUsedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `idx_srp_created` (`createdAt`)
);
