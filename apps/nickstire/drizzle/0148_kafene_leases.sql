-- 0148 - kafene_leases: Kafene lease checkout for tire orders (2026-10-18)
--
-- One row per Kafene application for a tire order. The browser SDK reports approval (uid) and
-- signing; an admin activates the lease at install (Kafene funds about 2 business days later).
-- Activation is a compare-and-swap on this row (status signed -> activating), so a lease is
-- activated at most once; that is why this is a table and not audit_log rows.
--
-- status is VARCHAR(24), never ENUM: TiDB runs STRICT_TRANS_TABLES and an out-of-enum write is
-- rejected and lost (nickstire-tidb-ddl). Values: started, approved, signed, activating,
-- activated, cancelled, declined, error, and applied (a keyless website application click). uid is Kafene's application id, unique across leases.
-- No column is added to tire_orders. The keyed checkout touches this table only when the KAFENE_*
-- env vars are all set; kafene.applyStarted and the admin status read work without them and
-- treat a missing table as not installed (the shop is still told), so prod is safe before this runs.
-- Hand-applied, idempotent. Mirrored in routers/nick/intelligence.ts handleRunMigrations.
CREATE TABLE IF NOT EXISTS kafene_leases (
  id INT AUTO_INCREMENT PRIMARY KEY,
  orderNumber VARCHAR(50) NOT NULL,
  uid VARCHAR(64) NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'started',
  merchandiseCents INT NOT NULL,
  activationDate DATE NULL,
  activatedAt DATETIME NULL,
  activatedBy VARCHAR(191) NULL,
  cancelledAt DATETIME NULL,
  lastError VARCHAR(255) NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY kafene_leases_uid_unique (uid),
  INDEX idx_kafene_leases_order (orderNumber)
) DEFAULT CHARSET=utf8mb4;
