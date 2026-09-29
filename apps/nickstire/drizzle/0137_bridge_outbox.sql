-- 0137 · bridge_outbox — ADR-0019 (docs/adr/0019-idempotent-bridge-writes.md) §5.1
--
-- The durable record of every nickstire -> StateNour fact, one row per
-- idempotency key. Phase 1 (Q-12 phase 1b) only SHADOW-enqueues: rows land
-- with status='shadow' and nothing drains them, while the legacy senders keep
-- running. The shadow rows are compared against leads / bookings / invoices to
-- prove completeness before any family is cut over.
--
-- Operator-applied (pnpm db:migrate). The table being present changes nothing
-- by itself: the enqueue runs only while the bridge_outbox_shadow flag is ON.
-- Before this is applied, a flag-ON enqueue catches the 1146 and logs
-- "bridge_outbox missing"; the legacy senders are untouched either way.
--
-- status is VARCHAR, not ENUM (nickstire-tidb-ddl): an out-of-enum value would
-- lose the failure handler's own write under STRICT_TRANS_TABLES. Longest
-- value today is 'delivered' (9 chars).

CREATE TABLE IF NOT EXISTS bridge_outbox (
  id               BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  idempotency_key  VARCHAR(190) NOT NULL,
  event_type       VARCHAR(80)  NOT NULL,
  route            VARCHAR(64)  NOT NULL,
  payload          JSON         NOT NULL,
  occurred_at      TIMESTAMP(3) NOT NULL,
  status           VARCHAR(32)  NOT NULL DEFAULT 'pending',
  attempts         INT          NOT NULL DEFAULT 0,
  due_at           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  claim_token      VARCHAR(36)  NULL,
  claimed_at       TIMESTAMP(3) NULL,
  last_http_status INT          NULL,
  last_error       VARCHAR(500) NULL,
  delivered_at     TIMESTAMP(3) NULL,
  created_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uniq_bridge_outbox_key (idempotency_key),
  KEY idx_bridge_outbox_status_due (status, due_at),
  KEY idx_bridge_outbox_created (created_at)
);
