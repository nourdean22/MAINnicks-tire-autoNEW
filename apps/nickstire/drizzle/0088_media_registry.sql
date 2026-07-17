-- 0088: canonical media asset registry + integration token store
-- Additive only. Hand-applied via scripts/apply-0088-media-registry.mts
-- (runner marks tracked without executing — the 0083-0087 trap).

CREATE TABLE IF NOT EXISTS `media_assets` (
  `id` varchar(64) NOT NULL,
  `logical_key` varchar(191) NOT NULL,
  `version` int NOT NULL DEFAULT 1,
  `is_current` int NOT NULL DEFAULT 1,
  `campaign_id` varchar(64) DEFAULT NULL,
  `genome_id` varchar(64) DEFAULT NULL,
  `visual_world_id` varchar(64) DEFAULT NULL,
  `parent_asset_id` varchar(64) DEFAULT NULL,
  `derived_from_json` text DEFAULT NULL,
  `asset_type` varchar(32) NOT NULL,
  `format` varchar(16) NOT NULL,
  `lifecycle_state` varchar(24) NOT NULL DEFAULT 'available',
  `provider` varchar(32) DEFAULT NULL,
  `provider_model` varchar(64) DEFAULT NULL,
  `provider_request_id` varchar(128) DEFAULT NULL,
  `original_provider_url` text DEFAULT NULL,
  `runtime_url` text DEFAULT NULL,
  `gdrive_file_id` varchar(128) DEFAULT NULL,
  `gdrive_folder_id` varchar(128) DEFAULT NULL,
  `gdrive_view_url` text DEFAULT NULL,
  `gdrive_sync_state` varchar(16) NOT NULL DEFAULT 'pending',
  `mime_type` varchar(64) NOT NULL,
  `byte_size` int NOT NULL,
  `width` int DEFAULT NULL,
  `height` int DEFAULT NULL,
  `duration_ms` int DEFAULT NULL,
  `checksum_sha256` varchar(64) NOT NULL,
  `generation_params_json` text DEFAULT NULL,
  `rights_status` varchar(24) NOT NULL DEFAULT 'ai_generated',
  `reuse_allowed` int NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_ma_logical_version` (`logical_key`, `version`),
  KEY `idx_ma_logical_current` (`logical_key`, `is_current`),
  KEY `idx_ma_checksum` (`checksum_sha256`),
  KEY `idx_ma_campaign` (`campaign_id`),
  KEY `idx_ma_lifecycle` (`lifecycle_state`)
);

CREATE TABLE IF NOT EXISTS `integration_tokens` (
  `name` varchar(64) NOT NULL,
  `config_json` text NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'healthy',
  `consecutive_failures` int NOT NULL DEFAULT 0,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`name`)
);
