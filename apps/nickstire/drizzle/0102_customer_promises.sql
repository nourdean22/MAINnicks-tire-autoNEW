-- 0102 · Customer Promise Ledger (plan PR-6 / roadmap Wave-4 sibling)
--
-- Every customer-facing promise becomes a durable obligation with an
-- owner, a due time, and an auditable outcome. Escalation goes into the
-- revenue_opportunities Decision Inbox — NOT a new alert channel, and
-- NEVER an automated customer send (status messages to customers remain
-- a verified-work-state feature for a later arc).
--
-- Hand-apply: pnpm exec tsx scripts/migrations/apply-customer-promises.ts

CREATE TABLE IF NOT EXISTS customer_promises (
  id VARCHAR(36) NOT NULL,
  promise_type VARCHAR(32) NOT NULL,
  customer_name VARCHAR(255) NULL,
  customer_phone VARCHAR(32) NULL,
  source_kind VARCHAR(24) NOT NULL DEFAULT 'operator',
  source_id VARCHAR(64) NULL,
  promised_action TEXT NOT NULL,
  owner VARCHAR(64) NULL,
  due_at TIMESTAMP NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'open',
  kept_at TIMESTAMP NULL,
  kept_evidence VARCHAR(300) NULL,
  escalated_at TIMESTAMP NULL,
  created_by VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_promise_status_due (status, due_at),
  KEY idx_promise_phone (customer_phone)
);
