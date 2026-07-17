/**
 * Hand-apply drizzle/0087_approval_expiry.sql (runner marks tracked without
 * executing - the 0083-0086 trap). Run from apps/nickstire:
 *
 *   pnpm exec tsx scripts/apply-0087-approval-expiry.mts
 */
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

const db = await getDb();
if (!db) { console.error("no database connection"); process.exit(1); }

const cols: any = await db.execute(sql`SHOW COLUMNS FROM social_content_approvals LIKE 'expires_at'`);
if ((cols[0] as any[]).length > 0) {
  console.log("expires_at: already present, skipping");
} else {
  await db.execute(sql`ALTER TABLE social_content_approvals ADD COLUMN expires_at timestamp NULL`);
  console.log("expires_at: ADDED");
}
const pv: any = await db.execute(sql`SHOW COLUMNS FROM social_content_approvals LIKE 'policy_version'`);
if ((pv[0] as any[]).length > 0) {
  console.log("policy_version: already present, skipping");
} else {
  await db.execute(sql`ALTER TABLE social_content_approvals ADD COLUMN policy_version int NULL`);
  console.log("policy_version: ADDED");
}
console.log("done - durable approval semantics live");
process.exit(0);
