-- 0100 · Recovery 2.0 — stated-concern capture + holdout assignment
--
-- Adds the evidence columns that make declined-work recovery routable on
-- the customer's OWN WORDS (revenue-truth doctrine: no psychology from
-- proxies) plus a durable holdout flag so recovery lift is MEASURED
-- against a control group instead of assumed.
--
-- One ALTER per column (TiDB rejects some multi-ADD forms; the
-- hand-apply script also guards each column via INFORMATION_SCHEMA so
-- re-runs are safe on any engine).
--
-- Hand-apply: pnpm exec tsx scripts/migrations/apply-recovery-stated-concern.ts

ALTER TABLE alg_estimates ADD COLUMN stated_concern VARCHAR(24) NULL;
ALTER TABLE alg_estimates ADD COLUMN stated_concern_source VARCHAR(24) NULL;
ALTER TABLE alg_estimates ADD COLUMN stated_concern_at TIMESTAMP NULL;
ALTER TABLE alg_estimates ADD COLUMN recovery_holdout TINYINT NULL;
