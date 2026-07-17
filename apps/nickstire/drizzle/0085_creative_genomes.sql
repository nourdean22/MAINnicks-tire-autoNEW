CREATE TABLE `creative_genomes` (
  `id` varchar(64) NOT NULL,
  `objective` varchar(32) NOT NULL,
  `territory` varchar(64) NOT NULL,
  `campaign_ask` text NOT NULL,
  `fingerprint` varchar(512) NOT NULL,
  `genome_json` text NOT NULL,
  `source` varchar(32) NOT NULL DEFAULT 'direct',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `creative_genomes_id` PRIMARY KEY(`id`)
);

CREATE INDEX `idx_creative_genomes_created` ON `creative_genomes` (`created_at`);