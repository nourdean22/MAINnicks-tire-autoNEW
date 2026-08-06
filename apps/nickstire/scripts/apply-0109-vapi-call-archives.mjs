/**
 * apply-0109-vapi-call-archives.mjs · hand-applied migration runner
 *
 * The generic runner is NOT usable here: it marks migrations tracked WITHOUT
 * executing them (the 0083-0087 trap, recorded in 0106). Every hand-applied
 * migration in this repo gets its own runner that executes, then VERIFIES.
 *
 * SAFETY
 *  · DRY RUN by default. --apply to execute.
 *  · The single statement is additive (CREATE TABLE IF NOT EXISTS). Nothing is
 *    dropped, renamed or retyped, so a partial apply is recoverable by
 *    re-running.
 *  · Verifies the end state by reading information_schema, not by trusting
 *    that the statement returned without error.
 *
 * Usage:
 *   node scripts/apply-0109-vapi-call-archives.mjs            # dry run
 *   node scripts/apply-0109-vapi-call-archives.mjs --apply    # execute
 */
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");

const url = readFileSync("C:/Users/nourd/NOURCITY/apps/nickstire/.env", "utf8")
  .split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="))
  ?.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");

const conn = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: true } });
const q = async (sql, args = []) => (await conn.execute(sql, args))[0];

const hasTable = async (table) =>
  (await q(
    `SELECT COUNT(*) n FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = ?`,
    [table],
  ))[0].n > 0;

console.log(`\n0109 vapi_call_archives · ${APPLY ? "APPLY" : "DRY RUN"}\n`);

/** Each step declares how to detect it is already done, so re-running is safe. */
const steps = [
  {
    name: "vapi_call_archives",
    done: () => hasTable("vapi_call_archives"),
    sql: `CREATE TABLE IF NOT EXISTS \`vapi_call_archives\` (
  \`id\` int AUTO_INCREMENT PRIMARY KEY,
  \`vapi_call_id\` varchar(64) NOT NULL,
  \`phone_number\` varchar(30) NULL,
  \`call_type\` varchar(32) NULL,
  \`ended_reason\` varchar(64) NULL,
  \`started_at\` timestamp NULL,
  \`ended_at\` timestamp NULL,
  \`duration_seconds\` int NULL,
  \`transcript\` mediumtext NULL,
  \`messages_json\` json NULL,
  \`recording_url\` varchar(500) NULL,
  \`stereo_recording_url\` varchar(500) NULL,
  \`summary\` text NULL,
  \`analysis_json\` json NULL,
  \`cost_total\` decimal(10,4) NULL,
  \`transcript_captured_at\` timestamp NULL,
  \`archived_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY \`vapi_call_archives_vapi_call_id_unique\` (\`vapi_call_id\`),
  KEY \`idx_vapi_archive_started\` (\`started_at\`)
)`,
  },
];

let executed = 0;
for (const step of steps) {
  const already = await step.done();
  if (already) {
    console.log(`  SKIP  ${step.name} — already present`);
    continue;
  }
  if (!APPLY) {
    console.log(`  WOULD ${step.name}`);
    continue;
  }
  await conn.query(step.sql); // query(), not execute(): DDL takes no params
  executed++;
  console.log(`  DONE  ${step.name}`);
}

console.log("\n─── verification (read back, do not trust the writes) ───");
console.log(`  table vapi_call_archives: ${(await hasTable("vapi_call_archives")) ? "PRESENT" : "MISSING"}`);

if (!APPLY) console.log("\nDRY RUN — re-run with --apply to execute.\n");
else console.log(`\napplied ${executed} statement(s).\n`);

await conn.end();
