-- business_facts — versioned business facts / approved-claims store (NCSOS #1/#2).
--
-- Business facts (prices, warranty terms, policies) were hardcoded across prompts,
-- templates and constants, so they drifted: a used-tire price three ways, and no
-- used-tire warranty existed at all. Worse, the repair warranty in code ("12
-- months / 12,000 miles") did not match the shop's actual invoice (1-year parts /
-- 90-day labor, no mileage warranty). One active row per factKey, each carrying
-- its provenance (source, approver, effective + verified dates) and the channels
-- it may be used on. Operator-editable override for the code-level SEED_FACTS in
-- server/services/businessFacts.ts. This mirrors the handleRunMigrations inline
-- DDL; the two must stay identical.

CREATE TABLE IF NOT EXISTS `business_facts` (
  `id` int AUTO_INCREMENT NOT NULL,
  `factKey` varchar(64) NOT NULL,
  `category` varchar(32) NOT NULL,
  `value` text NOT NULL,
  `source` varchar(255) NOT NULL,
  `approvedBy` varchar(100) NOT NULL,
  `effectiveDate` date NOT NULL,
  `verifiedDate` date NOT NULL,
  `channels` varchar(255) NOT NULL DEFAULT 'sms,voice,web',
  `active` tinyint NOT NULL DEFAULT 1,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `business_facts_id` PRIMARY KEY(`id`),
  CONSTRAINT `uniq_fact_key` UNIQUE(`factKey`)
);
--> statement-breakpoint
CREATE INDEX `idx_fact_active` ON `business_facts` (`active`);
