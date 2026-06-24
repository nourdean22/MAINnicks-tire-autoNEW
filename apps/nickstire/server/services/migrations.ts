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
      // Content Domination Engine tables (2026-06-24)
      `CREATE TABLE IF NOT EXISTS content_manufacturing_campaigns (
        id VARCHAR(64) PRIMARY KEY,
        topic VARCHAR(128) NOT NULL,
        persona VARCHAR(64) NOT NULL,
        target_monthly_volume INT NOT NULL DEFAULT 30,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_campaign_topic (topic)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      `CREATE TABLE IF NOT EXISTS social_content_inventory (
        id VARCHAR(64) PRIMARY KEY,
        campaign_id VARCHAR(64) NULL,
        content_type ENUM('reel', 'carousel', 'post', 'story', 'poll') NOT NULL,
        platform ENUM('instagram', 'facebook', 'both') NOT NULL DEFAULT 'both',
        topic VARCHAR(128) NOT NULL,
        series_name VARCHAR(128) NOT NULL,
        episode_number INT NOT NULL DEFAULT 1,
        hook_category VARCHAR(64) NOT NULL,
        hook_text TEXT NOT NULL,
        body_text TEXT NOT NULL,
        visual_style VARCHAR(64) NOT NULL,
        persona VARCHAR(64) NOT NULL,
        score_curiosity INT NOT NULL DEFAULT 0,
        score_emotion INT NOT NULL DEFAULT 0,
        score_shareability INT NOT NULL DEFAULT 0,
        score_comment_potential INT NOT NULL DEFAULT 0,
        score_save_potential INT NOT NULL DEFAULT 0,
        score_local_relevance INT NOT NULL DEFAULT 0,
        score_revenue_relevance INT NOT NULL DEFAULT 0,
        score_authority INT NOT NULL DEFAULT 0,
        score_hook_strength INT NOT NULL DEFAULT 0,
        score_overall INT NOT NULL DEFAULT 0,
        gsc_query_seed VARCHAR(255) NULL,
        weather_trigger_condition VARCHAR(128) NULL,
        interactive_dm_keyword VARCHAR(64) NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'pending',
        scheduled_at TIMESTAMP NULL DEFAULT NULL,
        published_at TIMESTAMP NULL DEFAULT NULL,
        asset_paths JSON NULL,
        brief_json TEXT NULL,
        error_message VARCHAR(500) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_sci_status_scheduled (status, scheduled_at),
        INDEX idx_sci_campaign (campaign_id),
        INDEX idx_sci_topic_type (topic, content_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
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
