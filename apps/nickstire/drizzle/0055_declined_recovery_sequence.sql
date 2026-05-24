-- 2026-05-23 · drizzle/0055_declined_recovery_sequence.sql
--
-- Extend the declined-work recovery from 2 touches (7d, 30d) to 5 touches
-- (3d, 7d, 14d, 30d, 45d) × 3 psychographic profiles (P1=broke_brenda,
-- P2=skeptical_pat, P3=busy_tim). 15 message variants total.
--
-- Schema additions (additive, no destructive changes):
--   * 3 new touch column-triplets (3d, 14d, 45d) mirroring the existing
--     7d/30d at-most-once claim pattern from wave-181.59
--   * recoveryProfile varchar(8) — caches the profile bucket on first
--     touch so subsequent touches stay consistent even if customer
--     signals shift
--
-- Apply manually to TiDB then `pnpm run check`. Auto-applies via
-- handleRunMigrations on next deploy.

ALTER TABLE alg_estimates ADD COLUMN follow_up_3d_sent INT NOT NULL DEFAULT 0;
ALTER TABLE alg_estimates ADD COLUMN follow_up_3d_attempted_at TIMESTAMP NULL DEFAULT NULL;
ALTER TABLE alg_estimates ADD COLUMN follow_up_3d_sent_at TIMESTAMP NULL DEFAULT NULL;

ALTER TABLE alg_estimates ADD COLUMN follow_up_14d_sent INT NOT NULL DEFAULT 0;
ALTER TABLE alg_estimates ADD COLUMN follow_up_14d_attempted_at TIMESTAMP NULL DEFAULT NULL;
ALTER TABLE alg_estimates ADD COLUMN follow_up_14d_sent_at TIMESTAMP NULL DEFAULT NULL;

ALTER TABLE alg_estimates ADD COLUMN follow_up_45d_sent INT NOT NULL DEFAULT 0;
ALTER TABLE alg_estimates ADD COLUMN follow_up_45d_attempted_at TIMESTAMP NULL DEFAULT NULL;
ALTER TABLE alg_estimates ADD COLUMN follow_up_45d_sent_at TIMESTAMP NULL DEFAULT NULL;

-- Profile bucket cache (set on first touch, sticky for the sequence)
ALTER TABLE alg_estimates ADD COLUMN recovery_profile VARCHAR(8) DEFAULT NULL;
CREATE INDEX idx_alg_est_recovery_profile ON alg_estimates (recovery_profile);
