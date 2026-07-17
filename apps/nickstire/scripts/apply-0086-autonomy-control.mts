/**
 * Hand-apply drizzle/0086_autonomy_control.sql to the database DATABASE_URL
 * points at. The db-migrate runner can mark migrations tracked without
 * executing them (0083/0084/0085 all hit that trap). Run from apps/nickstire:
 *
 *   pnpm exec tsx scripts/apply-0086-autonomy-control.mts
 */
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

const db = await getDb();
if (!db) { console.error("no database connection"); process.exit(1); }

const t1: any = await db.execute(sql`SHOW TABLES LIKE 'autonomy_policy_versions'`);
if ((t1[0] as any[]).length > 0) {
  console.log("table autonomy_policy_versions: already present, skipping");
} else {
  await db.execute(sql`CREATE TABLE autonomy_policy_versions (
    id int AUTO_INCREMENT NOT NULL,
    version int NOT NULL,
    policy_json text NOT NULL,
    note varchar(400) NOT NULL DEFAULT '',
    created_by varchar(120) NOT NULL DEFAULT 'operator',
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT autonomy_policy_versions_id PRIMARY KEY(id)
  )`);
  console.log("table autonomy_policy_versions: CREATED");
}

const t2: any = await db.execute(sql`SHOW TABLES LIKE 'autonomy_audit_events'`);
if ((t2[0] as any[]).length > 0) {
  console.log("table autonomy_audit_events: already present, skipping");
} else {
  await db.execute(sql`CREATE TABLE autonomy_audit_events (
    id varchar(64) NOT NULL,
    occurred_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    action_type varchar(48) NOT NULL,
    decision varchar(24) NOT NULL,
    reasoning_codes varchar(1024) NOT NULL,
    policy_version int NOT NULL,
    context_json text,
    campaign_id varchar(64),
    CONSTRAINT autonomy_audit_events_id PRIMARY KEY(id)
  )`);
  console.log("table autonomy_audit_events: CREATED");
}

const idx: any = await db.execute(sql`SHOW INDEX FROM autonomy_audit_events WHERE Key_name = 'idx_autonomy_audit_occurred'`);
if ((idx[0] as any[]).length > 0) {
  console.log("index: already present, skipping");
} else {
  await db.execute(sql`CREATE INDEX idx_autonomy_audit_occurred ON autonomy_audit_events (occurred_at)`);
  console.log("index: CREATED");
}
const uq: any = await db.execute(sql`SHOW INDEX FROM autonomy_policy_versions WHERE Key_name = 'uq_autonomy_policy_version'`);
if ((uq[0] as any[]).length > 0) {
  console.log("unique version index: already present, skipping");
} else {
  await db.execute(sql`CREATE UNIQUE INDEX uq_autonomy_policy_version ON autonomy_policy_versions (version)`);
  console.log("unique version index: CREATED");
}
const t3: any = await db.execute(sql`SHOW TABLES LIKE 'generation_reservations'`);
if ((t3[0] as any[]).length > 0) {
  console.log("table generation_reservations: already present, skipping");
} else {
  await db.execute(sql`CREATE TABLE generation_reservations (
    id varchar(64) NOT NULL,
    action_id varchar(64) NOT NULL,
    campaign_id varchar(64),
    provider varchar(48) NOT NULL,
    model varchar(64) NOT NULL,
    operation varchar(48) NOT NULL,
    estimated_cost_usd decimal(10,4) NOT NULL,
    actual_cost_usd decimal(10,4),
    is_estimate boolean NOT NULL DEFAULT true,
    status varchar(16) NOT NULL DEFAULT 'reserved',
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    settled_at timestamp NULL,
    CONSTRAINT generation_reservations_id PRIMARY KEY(id),
    CONSTRAINT uq_generation_reservations_action UNIQUE(action_id)
  )`);
  console.log("table generation_reservations: CREATED");
}
const gidx: any = await db.execute(sql`SHOW INDEX FROM generation_reservations WHERE Key_name = 'idx_generation_reservations_created'`);
if ((gidx[0] as any[]).length > 0) {
  console.log("reservations created index: already present, skipping");
} else {
  await db.execute(sql`CREATE INDEX idx_generation_reservations_created ON generation_reservations (created_at)`);
  console.log("reservations created index: CREATED");
}
console.log("done - autonomy control plane storage is live");
process.exit(0);
