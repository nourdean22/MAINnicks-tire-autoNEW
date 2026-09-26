-- 2026-09-23 · declined_work_captures: a decline the counter OBSERVED (Q-37)
--
-- HAND-APPLIED. The operator applies this; no agent runs it. Additive and idempotent:
-- one CREATE TABLE IF NOT EXISTS, no ALTER of an existing table, nothing dropped.
--
-- Why a table and not columns on alg_estimates: drizzle's MySQL insert names every
-- column in the table definition, so a new alg_estimates column would make the ShopDriver
-- estimate mirror's INSERT fail for the whole window between deploy and this DDL. Until
-- this table exists the app reads "counter capture not enabled", shows every decline as
-- inferred (which is then literally true), and the capture button says the migration is
-- pending instead of failing silently.
--
--   estimate_id    alg_estimates.id the customer declined. UNIQUE: the capture is a claim,
--                  so a second tap or a second device loses the insert and reads the
--                  winner back (services/declineCaptures.ts). No FK, matching how this
--                  schema links most mirror tables; an orphan row is harmless (it never
--                  joins).
--   declined_item  the estimate's service description, snapshotted when captured.
--   source         'counter' today. VARCHAR(32), not ENUM: TiDB rejects an out-of-enum
--                  write and the row is LOST.
--   captured_by    the admin who tapped, for the audit trail.
--   captured_at    TIMESTAMP (not DATETIME), matching alg_estimates.

CREATE TABLE IF NOT EXISTS declined_work_captures (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  estimate_id   INT          NOT NULL,
  declined_item VARCHAR(500) NULL DEFAULT NULL,
  source        VARCHAR(32)  NOT NULL DEFAULT 'counter',
  captured_by   VARCHAR(255) NULL DEFAULT NULL,
  captured_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_declined_capture_estimate (estimate_id)
);
