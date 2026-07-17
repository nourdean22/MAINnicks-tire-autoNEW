-- 0089: authenticated operator quality-override records (Creative Compiler 2.0
-- Milestone 1). An operator who accepts ADVISORY quality findings (critic REPAIR
-- — not a hard safety/rights/approval block) may publish a specific asset anyway.
-- The override binds to the EXACT (inventory_id, asset_version, content_hash):
-- any re-render/caption/audio/metadata change alters the hash and invalidates it.
-- It is consumed atomically at publish and can never bypass a hard gate.
-- Additive only. Hand-applied via scripts/apply-0089-operator-overrides.mts
-- (runner marks tracked without executing — the 0083-0087 trap).

CREATE TABLE IF NOT EXISTS `operator_quality_overrides` (
  `id` varchar(64) NOT NULL,
  `campaign_id` varchar(64) DEFAULT NULL,
  `inventory_id` varchar(64) NOT NULL,
  `asset_id` varchar(128) DEFAULT NULL,
  `asset_version` int NOT NULL,
  `content_hash` varchar(64) NOT NULL,
  `brief_hash` varchar(64) NOT NULL DEFAULT '',
  `action` varchar(32) NOT NULL DEFAULT 'publish_anyway',
  `accepted_finding_ids` text NOT NULL,
  `accepted_severities` varchar(255) NOT NULL,
  `operator_reason` text NOT NULL,
  `actor_id` int NOT NULL,
  `actor_email` varchar(255) DEFAULT NULL,
  `state` varchar(24) NOT NULL DEFAULT 'active',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `expires_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `consumed_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_oqo_binding` (`inventory_id`, `asset_version`, `state`),
  KEY `idx_oqo_hash` (`content_hash`),
  KEY `idx_oqo_campaign` (`campaign_id`)
);
