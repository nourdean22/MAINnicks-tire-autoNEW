/**
 * Hand-apply drizzle/0106_ig_insight_snapshots.sql (runner marks tracked
 * without executing — the 0083-0087 trap). Two ADDITIVE statements:
 *   1. ALTER instagram_analytics ADD mediaProductType (guarded — ALTER is not
 *      idempotent, so we check information_schema first and skip if present)
 *   2. CREATE TABLE IF NOT EXISTS ig_metric_snapshots (idempotent)
 * No DROP/DELETE/UPDATE anywhere in this file.
 *
 * Run from apps/nickstire (operator authorization — writes PROD DDL):
 *   pnpm exec tsx scripts/apply-0106-ig-insights.mts
 */
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

const db = await getDb();
if (!db) { console.error("no database connection"); process.exit(1); }

const rows = (res: unknown): unknown[] => (res as [unknown[], unknown])[0];

// 1. Guarded ALTER — skip when the column already exists.
const colCheck = rows(await db.execute(sql.raw(
  "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'instagram_analytics' AND COLUMN_NAME = 'mediaProductType'",
)));
if (colCheck.length > 0) {
  console.log("instagram_analytics.mediaProductType: already present — skipping ALTER");
} else {
  await db.execute(sql.raw("ALTER TABLE `instagram_analytics` ADD COLUMN `mediaProductType` varchar(32) NULL"));
  console.log("instagram_analytics.mediaProductType: ADDED");
}

// 2. Idempotent CREATE.
await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS \`ig_metric_snapshots\` (
  \`id\` int AUTO_INCREMENT PRIMARY KEY,
  \`postId\` varchar(100) NOT NULL,
  \`capturedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`likes\` int NOT NULL DEFAULT 0,
  \`comments\` int NOT NULL DEFAULT 0,
  \`reach\` int NULL,
  \`saved\` int NULL,
  \`views\` int NULL,
  \`shares\` int NULL,
  \`followerSnapshot\` int NULL,
  KEY \`idx_ig_snap_post\` (\`postId\`),
  KEY \`idx_ig_snap_captured\` (\`capturedAt\`)
)`));
console.log("ig_metric_snapshots: created (IF NOT EXISTS — idempotent)");

// Post-checks — assert, don't assume (each applicator proves its own work).
const col = rows(await db.execute(sql.raw(
  "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'instagram_analytics' AND COLUMN_NAME = 'mediaProductType'",
)));
if (col.length !== 1) { console.error("POST-CHECK FAILED: mediaProductType column absent after apply"); process.exit(1); }
const snapCols = rows(await db.execute(sql.raw("SHOW COLUMNS FROM ig_metric_snapshots")));
if (snapCols.length !== 10) { console.error(`POST-CHECK FAILED: ig_metric_snapshots has ${snapCols.length} columns, expected 10`); process.exit(1); }
console.log(`post-checks green: mediaProductType present · ig_metric_snapshots ${snapCols.length} columns`);
console.log("done — 0106 live");
process.exit(0);
