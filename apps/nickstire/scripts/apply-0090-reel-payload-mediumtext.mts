/**
 * Hand-apply drizzle/0090_reel_jobs_payload_mediumtext.sql (runner marks tracked
 * without executing — the 0083-0087 trap). Additive, non-destructive widening of
 * reel_jobs.payload TEXT -> MEDIUMTEXT; MODIFY to an already-MEDIUMTEXT column is
 * a no-op, so this is idempotent. Already applied to PROD during the CC2
 * live-render drive; this script codifies it for fresh environments.
 *
 * Run from apps/nickstire (needs operator authorization — writes to PROD DB):
 *
 *   pnpm exec tsx scripts/apply-0090-reel-payload-mediumtext.mts
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { getDb } from "../server/db";
import { sql } from "drizzle-orm";

const db = await getDb();
if (!db) { console.error("no database connection"); process.exit(1); }

const ddl = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../drizzle/0090_reel_jobs_payload_mediumtext.sql"), "utf-8");
// Strip comment LINES before splitting so the leading comment block never glues
// to the ALTER (the 0088 apply-script bug, verified against a bare dev DB).
const statements = ddl
  .replace(/^--.*$/gm, "")
  .split(/;\s*(?:\n|$)/)
  .map((s) => s.trim())
  .filter(Boolean);
if (statements.length !== 1) {
  console.error(`expected 1 DDL statement, parsed ${statements.length} — refusing`);
  process.exit(1);
}

for (const stmt of statements) {
  await db.execute(sql.raw(stmt));
  console.log("reel_jobs.payload: MODIFY MEDIUMTEXT applied (idempotent)");
}

const res: unknown = await db.execute(
  sql.raw("SELECT DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_NAME='reel_jobs' AND COLUMN_NAME='payload'"),
);
const rows = (res as [Array<{ DATA_TYPE?: string }>, unknown])[0];
const dt = rows?.[0]?.DATA_TYPE;
console.log(`reel_jobs.payload DATA_TYPE = ${dt}`);
if (dt !== "mediumtext") { console.error("verification FAILED — expected mediumtext"); process.exit(1); }
console.log("done — reel_jobs.payload is MEDIUMTEXT");
process.exit(0);
