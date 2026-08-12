-- 0111: admin_proposals — the generic approval queue (trust ladder).
--
-- WHY: five domain-specific approval lanes exist (IG studio drafts,
-- review_replies, sms_learning_recommendations, revenue_opportunities,
-- nickgpt_drafts) but there is NO generic place where a NEW class of
-- AI-originated or one-tap admin action can land as a reviewable proposal
-- instead of an executed write. This table is that place: every row is an
-- intent (payload_json validated against a server-side executor registry),
-- and the ONLY path to execution is the CAS transition
-- draft/pending_review -> approved -> executing -> executed run by
-- services/proposals.ts. Existing lanes are deliberately NOT migrated onto
-- this table — they keep their own hash-sealing/TTL semantics.
--
-- status is varchar(32), NOT an enum (STRICT_TRANS_TABLES loses out-of-enum
-- rows; 0099 records the standing reason). Statuses today:
--   draft | pending_review | approved | executing | executed | failed | rejected
--
-- Every statement is ADDITIVE (CREATE TABLE IF NOT EXISTS); a partial apply
-- is recoverable by re-running.
--
-- Hand-applied via scripts/apply-0111-admin-proposals.mjs. Do NOT use the
-- generic runner (0083-0087 trap, recorded in 0106).

CREATE TABLE IF NOT EXISTS `admin_proposals` (
  `id` varchar(36) PRIMARY KEY,
  `source` varchar(24) NOT NULL,
  `actor` varchar(100) NOT NULL,
  `action_type` varchar(48) NOT NULL,
  `entity_type` varchar(50) NULL,
  `entity_id` varchar(64) NULL,
  `title` varchar(255) NOT NULL,
  `payload_json` json NOT NULL,
  `context_json` json NULL,
  `confidence` int NULL,
  `status` varchar(32) NOT NULL DEFAULT 'draft',
  `reviewed_by` varchar(100) NULL,
  `reviewed_at` timestamp NULL,
  `review_note` text NULL,
  `executed_at` timestamp NULL,
  `execution_result_json` json NULL,
  `idempotency_key` varchar(191) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uniq_proposals_idem` (`idempotency_key`),
  KEY `idx_proposals_status` (`status`, `created_at`),
  KEY `idx_proposals_entity` (`entity_type`, `entity_id`)
);
