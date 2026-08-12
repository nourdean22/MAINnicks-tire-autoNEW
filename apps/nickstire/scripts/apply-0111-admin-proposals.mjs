/**
 * apply-0111-admin-proposals.mjs · hand-applied migration runner
 *
 * The generic runner is NOT usable here: it marks migrations tracked WITHOUT
 * executing them (the 0083-0087 trap, recorded in 0106). Every hand-applied
 * migration in this repo gets its own runner that executes, then VERIFIES.
 *
 * SAFETY
 *  · DRY RUN by default. --apply to execute.
 *  · The single statement is additive (CREATE TABLE IF NOT EXISTS). Nothing is
 *    dropped, renamed or retyped; a partial apply is recoverable by re-running.
 *  · Verifies the end state by reading information_schema, not by trusting
 *    that the statement returned without error.
 *
 * Usage:
 *   node scripts/apply-0111-admin-proposals.mjs            # dry run
 *   node scripts/apply-0111-admin-proposals.mjs --apply    # execute
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

console.log(`\n0111 admin_proposals · ${APPLY ? "APPLY" : "DRY RUN"}\n`);

/** Each step declares how to detect it is already done, so re-running is safe. */
const steps = [
  {
    name: "admin_proposals",
    done: () => hasTable("admin_proposals"),
    sql: `CREATE TABLE IF NOT EXISTS \`admin_proposals\` (
  \`id\` varchar(36) PRIMARY KEY,
  \`source\` varchar(24) NOT NULL,
  \`actor\` varchar(100) NOT NULL,
  \`action_type\` varchar(48) NOT NULL,
  \`entity_type\` varchar(50) NULL,
  \`entity_id\` varchar(64) NULL,
  \`title\` varchar(255) NOT NULL,
  \`payload_json\` json NOT NULL,
  \`context_json\` json NULL,
  \`confidence\` int NULL,
  \`status\` varchar(32) NOT NULL DEFAULT 'draft',
  \`reviewed_by\` varchar(100) NULL,
  \`reviewed_at\` timestamp NULL,
  \`review_note\` text NULL,
  \`executed_at\` timestamp NULL,
  \`execution_result_json\` json NULL,
  \`idempotency_key\` varchar(191) NULL,
  \`created_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY \`uniq_proposals_idem\` (\`idempotency_key\`),
  KEY \`idx_proposals_status\` (\`status\`, \`created_at\`),
  KEY \`idx_proposals_entity\` (\`entity_type\`, \`entity_id\`)
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
console.log(`  table admin_proposals: ${(await hasTable("admin_proposals")) ? "PRESENT" : "MISSING"}`);

if (!APPLY) console.log("\nDRY RUN — re-run with --apply to execute.\n");
else console.log(`\napplied ${executed} statement(s).\n`);

await conn.end();
