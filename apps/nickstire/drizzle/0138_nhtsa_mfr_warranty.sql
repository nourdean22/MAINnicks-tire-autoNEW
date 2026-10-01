-- 0138 · NHTSA manufacturer warranty extensions — ADR-0021 (docs/adr/0021-nhtsa-warranty-extension-ingest.md) §5
--
-- Two tables, filled by the nhtsa-warranty-ingest job (Q-50 phase 2a) from NHTSA's public
-- manufacturer-communications file. They hold only the communications classified as warranty
-- extensions (about 2,550 across 2015-2026, 34,151 product rows). Public facts about vehicle
-- models: no PII, no foreign key to work orders or customers.
--
-- Operator-applied. The tables being present changes nothing by itself: the job writes only while
-- the nhtsa_warranty_ingest flag is ON, and nothing reads them until phase 2b's panel ships.
-- Before this is applied, a flag-ON run logs "migration 0138_nhtsa_mfr_warranty not applied"
-- and writes nothing.
--
-- Deviation from ADR-0021 §5, on purpose: the classification column is match_signal, not signal.
-- SIGNAL is a reserved word in MySQL and TiDB, so the bare name would need backquotes in every
-- query that ever names it.
--
-- Widths are the spec's own maximums (TSBS.txt); the parser truncates to these widths before
-- every write (nhtsaWarrantyParse.ts WIDTH), because TiDB STRICT rejects an over-width value and
-- loses the row (nickstire-tidb-ddl). match_signal is VARCHAR, not ENUM; its longest value is
-- 'summary_text' (12 chars).
--
-- "Current" rows: every row a chunk pass sees gets that pass's last_seen_at. A communication NHTSA
-- drops keeps its row, but its last_seen_at stops moving, so the read path (phase 2b) shows only
-- rows seen by the latest successful pass of their source_chunk.
--
-- Additive and idempotent: a re-run is a no-op.
-- Apply (operator only): scoped runner per prod-db-guard, e.g.
--   railway run --service MAINnicks-tire-auto -- node <scoped runner> drizzle/0138_nhtsa_mfr_warranty.sql
-- Verify afterwards (read-only):
--   SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()
--     AND TABLE_NAME IN ('nhtsa_mfr_warranty_comms', 'nhtsa_mfr_warranty_products');

CREATE TABLE IF NOT EXISTS nhtsa_mfr_warranty_comms (
  nhtsa_id           BIGINT       NOT NULL PRIMARY KEY,
  document_id        VARCHAR(128) NOT NULL,
  mfr_campaign_id    VARCHAR(128) NULL,
  communication_type VARCHAR(64)  NOT NULL,
  match_signal       VARCHAR(32)  NOT NULL,
  matched_phrase     VARCHAR(64)  NULL,
  mfr_date           DATE         NULL,
  added_date         DATE         NULL,
  components         VARCHAR(512) NULL,
  summary            TEXT         NOT NULL,
  source_chunk       VARCHAR(32)  NOT NULL,
  last_seen_at       TIMESTAMP(3) NOT NULL,
  KEY idx_nhtsa_comms_last_seen (last_seen_at)
);

CREATE TABLE IF NOT EXISTS nhtsa_mfr_warranty_products (
  nhtsa_id   BIGINT       NOT NULL,
  make_norm  VARCHAR(128) NOT NULL,
  model_norm VARCHAR(256) NOT NULL,
  model_year SMALLINT     NOT NULL,
  make_raw   VARCHAR(128) NOT NULL,
  model_raw  VARCHAR(256) NOT NULL,
  PRIMARY KEY (nhtsa_id, make_norm, model_norm, model_year),
  KEY idx_nhtsa_products_ymm (make_norm, model_year, model_norm)
);
