-- 2026-09-23 · tire_registrations: each installed tire's TIN (DOT code) + how 49 CFR 574.8 was met (Q-47)
--
-- 49 CFR 574.8(a) requires an independent dealer selling NEW tires to either hand the buyer a
-- registration form carrying each tire's identification number and the dealer's name and street
-- address, or register the tires with the manufacturer (paper or electronic) within 30 days.
-- Nothing in the shop captured a TIN before this table (Q-47 in
-- docs/research/2026-09-23-estate-master-architecture.md §10.3).
--
-- One row per tire POSITION on an existing work order. No parallel order model: the sale is the
-- work order and its `tire` line items; this table only adds what those rows cannot hold.
--
-- NO FOREIGN KEY to work_orders, on purpose: work_order_items cascades on delete, and a
-- compliance record must outlive a deleted or re-created work order. work_order_id is indexed.
--
--   position            LF | RF | LR | RR | LRI | RRI | SPARE          (app-validated, max 5)
--   tin                 normalized TIN, uppercase, no spaces, no "DOT"  (574.5: at most 13)
--                       NULL = position reserved but TIN not captured yet
--   tin_status          valid | legacy_date_code | invalid             (max 16)
--   tin_week/tin_year   date of manufacture decoded from the TIN (NULL when unknown)
--   tire_condition      new | used   (574.8 covers new tires only)
--   registration_method pending | form_given | dealer_submitted_paper
--                       | dealer_submitted_electronic | not_required_used   (max 27)
--   registered_at/by    when + who recorded the registration step
--
-- Every status-like column is VARCHAR(32), not ENUM: TiDB runs STRICT_TRANS_TABLES, so an
-- out-of-enum or over-width write is REJECTED and the row is lost (nickstire-tidb-ddl).
-- TIMESTAMP, not DATETIME, matching the rest of the schema (DATETIME comes back shifted on ET).
--
-- Additive and idempotent: a re-run is a no-op. Nothing reads this table until the code that
-- ships with it is deployed, and that code only reads it when an admin opens a work order.
--
-- Apply (operator only): scoped runner per prod-db-guard, e.g.
--   railway run --service MAINnicks-tire-auto -- node <scoped runner> drizzle/0131_tire_registrations.sql
-- Verify afterwards (read-only):
--   SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tire_registrations';

CREATE TABLE IF NOT EXISTS tire_registrations (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  work_order_id       VARCHAR(36)  NOT NULL,
  position            VARCHAR(8)   NOT NULL,
  tin                 VARCHAR(20)  NULL DEFAULT NULL,
  tin_status          VARCHAR(32)  NULL DEFAULT NULL,
  tin_week            INT          NULL DEFAULT NULL,
  tin_year            INT          NULL DEFAULT NULL,
  tire_brand          VARCHAR(100) NULL DEFAULT NULL,
  tire_condition      VARCHAR(8)   NOT NULL DEFAULT 'new',
  registration_method VARCHAR(32)  NOT NULL DEFAULT 'pending',
  registered_at       TIMESTAMP    NULL DEFAULT NULL,
  registered_by       VARCHAR(100) NULL DEFAULT NULL,
  captured_by         VARCHAR(100) NULL DEFAULT NULL,
  created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tire_reg_wo_position (work_order_id, position),
  KEY idx_tire_reg_tin (tin)
);
