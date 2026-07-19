-- content_runs — ONE durable parent for a single "make me something" request.
--
-- Today an operator navigates between concepts, inventory rows, reel jobs, media
-- assets, approvals and publish attempts, and has to hold the relationship
-- between them in their head. Each of those tables is correct on its own; none of
-- them answers "what happened to the thing I asked for at 9am".
--
-- This does NOT replace them. It REFERENCES them, so existing gates, hashes and
-- provenance keep working exactly as they do now.
--
-- Two things it carries that nothing else does:
--   1. THE DECISION AND ITS REASON — which format, why that one, what evidence.
--   2. THE TWO-STATE MODEL — implementation_state (what was built) separate from
--      operational_state (what was PROVEN in production). Collapsing those is how
--      a green checkmark ends up over work that never happened; this session had
--      an override button that reported success while the publish was refused.
--
-- Widths are deliberate. `published_partial` (17 chars) once went into a
-- varchar(16) and was REJECTED under STRICT_TRANS_TABLES, wedging rows — every
-- status column here is varchar(32) or wider.

CREATE TABLE IF NOT EXISTS `content_runs` (
  `id` varchar(64) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- WHO asked, and for what. requestedFormat NULL = "choose for me".
  `requestedBy` varchar(64) NULL,
  `requestSource` varchar(32) NOT NULL DEFAULT 'operator',
  `requestedTopic` text NULL,
  `requestedFormat` varchar(32) NULL,

  -- WHAT the system decided, and WHY. formatReason is not decoration: an
  -- operator who cannot see why a format was chosen cannot correct the choice.
  `chosenFormat` varchar(32) NULL,
  `formatReason` varchar(1000) NULL,
  `objective` varchar(64) NULL,
  `thesis` text NULL,

  -- The identities this run OWNS. Nullable because they appear at different
  -- stages, and a static post never gets a reel job at all.
  `inventoryId` varchar(64) NULL,
  `reelJobId` int NULL,
  `approvalId` varchar(64) NULL,

  -- WHERE IT IS. One vocabulary for every format.
  `stage` varchar(32) NOT NULL DEFAULT 'requested',

  -- THE TWO-STATE MODEL. Never collapse these.
  `implementationState` varchar(32) NOT NULL DEFAULT 'pending',
  `operationalState` varchar(32) NOT NULL DEFAULT 'unproven',

  -- The evidence chain behind operationalState, and what it cost.
  `evidenceJson` mediumtext NULL,
  `costCents` int NOT NULL DEFAULT 0,

  -- Why it stopped, in the operator's words, when it stopped.
  `failureReason` varchar(1000) NULL,

  CONSTRAINT `content_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_content_runs_stage` ON `content_runs` (`stage`);
--> statement-breakpoint
CREATE INDEX `idx_content_runs_created` ON `content_runs` (`createdAt`);
--> statement-breakpoint
CREATE INDEX `idx_content_runs_inventory` ON `content_runs` (`inventoryId`);
--> statement-breakpoint
CREATE INDEX `idx_content_runs_reel_job` ON `content_runs` (`reelJobId`);
