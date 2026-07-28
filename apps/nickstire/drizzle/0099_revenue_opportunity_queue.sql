-- 0099 · Revenue Opportunity Queue (REVENUE-OPS-ROADMAP Wave 4)
--
-- One durable queue consolidating missed revenue opportunities from every
-- source system, with owner, state, attempts, consent, evidence and audit
-- history — per the roadmap's Wave-4 contract. Hand-applied via
-- scripts/migrations/apply-opportunity-queue.ts (idempotent). Code reads
-- this table through server/services/opportunityQueue.ts, which degrades
-- gracefully (returns empty) when the table is not yet applied.
--
-- Design notes:
--   - VARCHAR + app-level validation instead of ENUM: TiDB STRICT_TRANS_TABLES
--     REJECTS out-of-enum writes (row lost) and ENUM evolution needs ALTERs.
--   - (source_type, source_id) UNIQUE = dedup: one opportunity per source
--     record, ever. Collectors upsert; refreshes never touch state/owner.
--   - receipts_json = append-only audit history of every transition.
--   - won requires outcome_invoice_id (roadmap: "measure recovery only
--     from verified later outcomes") — enforced in the service layer.

CREATE TABLE IF NOT EXISTS revenue_opportunities (
  id VARCHAR(36) NOT NULL,
  source_type VARCHAR(32) NOT NULL,
  source_id VARCHAR(64) NOT NULL,
  customer_id INT NULL,
  customer_name VARCHAR(255) NULL,
  customer_phone VARCHAR(32) NULL,
  expected_revenue_cents INT NULL,
  data_quality VARCHAR(16) NOT NULL DEFAULT 'inferred',
  urgency VARCHAR(16) NOT NULL DEFAULT 'this_week',
  recommended_action TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence_json JSON NULL,
  owner VARCHAR(64) NULL,
  due_at TIMESTAMP NULL,
  state VARCHAR(24) NOT NULL DEFAULT 'new',
  attempts INT NOT NULL DEFAULT 0,
  consent_ok TINYINT(1) NOT NULL DEFAULT 1,
  receipts_json JSON NULL,
  outcome_invoice_id INT NULL,
  outcome_verified_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_opportunity_source (source_type, source_id),
  KEY idx_opportunity_state (state),
  KEY idx_opportunity_due (due_at),
  KEY idx_opportunity_updated (updated_at)
);
