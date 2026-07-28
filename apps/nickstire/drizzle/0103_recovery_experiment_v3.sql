-- 0103 · Recovery Experiment v3 — versioned, timestamped assignment.
--
-- Why: the v2 holdout used raw `id % 100 < 15` with no experiment version
-- and no assignment timestamp, so (a) a formula change would silently
-- reassign in-flight rows, (b) outcome windows had to lean on
-- estimate_date instead of assignment time, and (c) legacy-policy rows
-- were indistinguishable from current-policy rows in the readout.
-- Additive nullable columns only. Hand-applied via
-- scripts/migrations/apply-recovery-experiment-v3.ts (idempotent).
ALTER TABLE alg_estimates ADD COLUMN recovery_experiment_version VARCHAR(8) NULL;
ALTER TABLE alg_estimates ADD COLUMN recovery_assigned_at TIMESTAMP NULL;
