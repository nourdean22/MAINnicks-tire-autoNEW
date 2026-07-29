/**
 * Hand-apply drizzle/0107_reel_patterns.sql (runner marks tracked without
 * executing — the 0083-0087 trap). ONE additive CREATE TABLE IF NOT EXISTS;
 * no DROP/DELETE/UPDATE anywhere in this file.
 *
 * Run from apps/nickstire (operator authorization — writes PROD DDL):
 *   pnpm exec tsx scripts/apply-0107-reel-patterns.mts
 */
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

const db = await getDb();
if (!db) { console.error("no database connection"); process.exit(1); }

const rows = (res: unknown): unknown[] => (res as [unknown[], unknown])[0];

await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS \`social_reel_patterns\` (
  \`id\` varchar(64) PRIMARY KEY,
  \`label\` varchar(80) NOT NULL,
  \`hookType\` varchar(32) NOT NULL,
  \`loopType\` varchar(32) NOT NULL,
  \`patternJson\` text NOT NULL,
  \`timesUsed\` int NOT NULL DEFAULT 0,
  \`lastUsedAt\` timestamp NULL,
  \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updatedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY \`idx_srp_created\` (\`createdAt\`)
)`));
console.log("social_reel_patterns: created (IF NOT EXISTS — idempotent)");

const cols = rows(await db.execute(sql.raw("SHOW COLUMNS FROM social_reel_patterns")));
if (cols.length !== 9) { console.error(`POST-CHECK FAILED: social_reel_patterns has ${cols.length} columns, expected 9`); process.exit(1); }
console.log(`post-checks green: social_reel_patterns ${cols.length} columns`);
console.log("done — 0107 live");
process.exit(0);
