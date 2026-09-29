-- 2026-09-26 · Q-43 append-only cross-channel consent ledger
--
-- HAND-APPLIED. The operator applies this separately; agents do not execute it.
-- Additive and idempotent: CREATE TABLE IF NOT EXISTS only, no ALTER/DROP.
-- VARCHARs are deliberate: an out-of-enum consent value must never lose a row.

CREATE TABLE IF NOT EXISTS contact_consent_events (
  id                    BIGINT       NOT NULL AUTO_INCREMENT,
  subject_type          VARCHAR(8)   NOT NULL,
  subject_key           VARCHAR(255) NOT NULL,
  customer_key          VARCHAR(64)  NULL,
  scope                 VARCHAR(32)  NOT NULL,
  action                VARCHAR(16)  NOT NULL,
  source                VARCHAR(48)  NOT NULL,
  method                VARCHAR(32)  NOT NULL,
  disclosure_id         VARCHAR(64)  NULL,
  disclosure_version    VARCHAR(16)  NULL,
  disclosure_sha256     CHAR(64)     NULL,
  evidence_ref          VARCHAR(191) NOT NULL,
  evidence_excerpt      VARCHAR(160) NULL,
  detector_version      VARCHAR(16)  NULL,
  ip_address            VARCHAR(45)  NULL,
  user_agent            VARCHAR(300) NULL,
  actor                 VARCHAR(100) NOT NULL,
  occurred_at           DATETIME(3)  NOT NULL,
  occurred_at_estimated TINYINT      NOT NULL DEFAULT 0,
  recorded_at           TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  review_status         VARCHAR(16)  NULL,
  reviewed_by           VARCHAR(100) NULL,
  reviewed_at           DATETIME     NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_contact_consent_event (
    subject_type, subject_key, source, evidence_ref, scope, action
  ),
  KEY idx_contact_consent_subject (subject_type, subject_key, occurred_at),
  KEY idx_contact_consent_review (action, review_status)
);
