// ─── Schema Migrations (idempotent ALTER TABLE) ────────
// Extracted verbatim from server/_core/index.ts. Fire-and-forget boot
// block — must NOT block server boot, so this is intentionally not
// awaited by the caller (runServerMigrations() is called bare).

import { createLogger } from "../lib/logger";

const serverLog = createLogger("server");

export function runServerMigrations(): void {
  import("../db").then(async ({ getDb }) => {
    const db = await getDb();
    if (!db) return;
    const { sql } = await import("drizzle-orm");
    const alters = [
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS totalSpent int NOT NULL DEFAULT 0 AFTER totalVisits`,
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS firstVisitDate timestamp NULL AFTER lastVisitDate`,
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS vehicleYear varchar(10) NULL AFTER balanceDue`,
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS vehicleMake varchar(50) NULL AFTER vehicleYear`,
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS vehicleModel varchar(50) NULL AFTER vehicleMake`,
      // Migration 0024: Retention SMS tracking
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS lastRetentionTier int DEFAULT NULL`,
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS lastRetentionDate timestamp DEFAULT NULL`,
      // Migration 0025: Booking confirmation tracking
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS confirmedAt timestamp NULL`,
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS confirmationMethod varchar(20) NULL`,
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS confirmationSentAt timestamp NULL`,
      // Revenue pipeline: quote $ tracking + money aging on leads
      `ALTER TABLE leads ADD COLUMN IF NOT EXISTS estimatedValueCents int DEFAULT NULL`,
      `ALTER TABLE leads ADD COLUMN IF NOT EXISTS lastFollowUpAt timestamp DEFAULT NULL`,
      // Google Ads offline conversion tracking (gclid)
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS gclid varchar(255) DEFAULT NULL`,
      `ALTER TABLE leads ADD COLUMN IF NOT EXISTS gclid varchar(255) DEFAULT NULL`,
      // PWA push subscriptions table
      `CREATE TABLE IF NOT EXISTS push_subscriptions (
        id varchar(36) NOT NULL PRIMARY KEY,
        customer_id varchar(36) DEFAULT NULL,
        endpoint text NOT NULL,
        p256dh varchar(255) NOT NULL,
        auth_key varchar(255) NOT NULL,
        is_admin tinyint(1) NOT NULL DEFAULT 0,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_push_customer (customer_id),
        INDEX idx_push_admin (is_admin)
      )`,
      // ═══ CRITICAL: invoices.workOrderId — linking invoices to work orders ═══
      // Root cause of: admin $0 revenue, nickActions.shopPulse failure,
      // invoices.intelligence failure, customer-intelligence failure, statenourSync failure.
      // Drizzle schema had this column but actual TiDB table never got it.
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS workOrderId int NULL AFTER bookingId`,
      // ═══ review_pipeline schema drift (admin review queue) ═══
      `ALTER TABLE review_pipeline ADD COLUMN IF NOT EXISTS reviewed int NOT NULL DEFAULT 0`,
      `ALTER TABLE review_pipeline ADD COLUMN IF NOT EXISTS responseSent int NOT NULL DEFAULT 0`,
    ];
    let applied = 0;
    for (const stmt of alters) {
      try { await db.execute(sql.raw(stmt)); applied++; } catch (e) { serverLog.warn("[server:migration] schema ALTER failed", { stmt: stmt.slice(0, 60), error: e instanceof Error ? e.message : String(e) }); }
    }
    if (applied > 0) {
      serverLog.info(`Schema migrations: ${applied} column checks passed`);
    }
  }).catch(e => serverLog.warn("[server:migration] schema migration runner failed", { error: e instanceof Error ? e.message : String(e) }));
}
