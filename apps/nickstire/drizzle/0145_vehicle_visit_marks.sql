-- 0145 - operator visit marks (camera audit 2026-10-07, N1)
--
-- The sign camera sees arrive / park / bay; it cannot see "the customer is waiting in the
-- lobby", "a tech started on it in the lot", "done, waiting for pickup" or "this was never a
-- job". Each is one tap on the floor board, appended here with the SERVER clock. The latest
-- mark of each kind is the truth; the rows are the audit trail. lot.now derives service start
-- = MIN(bayEnteredAt, SERVICE_STARTED), service duration and pickup wait from them; an
-- unmarked car stays UNKNOWN. Marks are the labelled set the outside-service classifier needs
-- before any review worker is installed.
--
-- mark is VARCHAR(32), never ENUM: TiDB runs STRICT_TRANS_TABLES and an out-of-enum write is
-- rejected and lost (nickstire-tidb-ddl). The vocabulary lives in shared/visitMarks.ts.
-- markedBy is the admin's openId, for audit only; it is never sent to the browser.
-- Hand-applied, idempotent. Mirrored in routers/nick/intelligence.ts handleRunMigrations and
-- scripts/migrations/apply-vehicle-visit-marks.ts. Until it runs, lot.markVisit refuses with
-- the migration's name and the floor board shows no buttons, never a silent no-op.
CREATE TABLE IF NOT EXISTS vehicle_visit_marks (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  visitId VARCHAR(64) NOT NULL,
  mark VARCHAR(32) NOT NULL,
  markedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  markedBy VARCHAR(191) NOT NULL,
  note VARCHAR(191) NULL,
  INDEX idx_vehicle_visit_marks_visit (visitId, markedAt)
);
