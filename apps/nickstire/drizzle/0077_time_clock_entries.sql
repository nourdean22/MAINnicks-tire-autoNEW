-- 2026-07-09 · drizzle/0077_time_clock_entries.sql · AG-43
--
-- Durable time-clock ledger. The dispatch board's clock-in/out today is a
-- single mutable pair on technicians (clocked_in BOOLEAN + clocked_in_at) —
-- every clock-out ERASES the shift, so weekly hours / payroll history is
-- unrecoverable. This table appends one row per shift; the boolean pair
-- stays as the live "who's on the floor now" cache.
--
-- technician_id is INT (not BIGINT) — it must match technicians.id, which is
-- INT AUTO_INCREMENT. ON DELETE RESTRICT: a technician with recorded shifts
-- is payroll history — deactivate (isActive=0), never delete.
--
-- ⚠️ OPERATOR-APPLIED (railway-run pattern, per nickstire migration rules).
--    NEVER auto-apply. No pre-check needed — pure CREATE TABLE, no data
--    backfill; the ledger starts recording from the first clock-in after
--    deploy.

CREATE TABLE `time_clock_entries` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `technician_id` INT NOT NULL,
  `clock_in_at` TIMESTAMP NOT NULL,
  `clock_out_at` TIMESTAMP NULL,
  `source` VARCHAR(32) NOT NULL DEFAULT 'admin_ui',
  INDEX `idx_tce_tech_clockin` (`technician_id`, `clock_in_at`),
  CONSTRAINT `fk_tce_technician` FOREIGN KEY (`technician_id`)
    REFERENCES `technicians` (`id`) ON DELETE RESTRICT
);
