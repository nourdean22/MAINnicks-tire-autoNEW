/**
 * apply-0108-content-experiments.mjs · hand-applied migration runner
 *
 * The generic runner is NOT usable here: it marks migrations tracked WITHOUT
 * executing them (the 0083-0087 trap, recorded in 0106). Every hand-applied
 * migration in this repo gets its own runner that executes, then VERIFIES.
 *
 * SAFETY
 *  · DRY RUN by default. --apply to execute.
 *  · Every statement is additive (ADD COLUMN / CREATE TABLE IF NOT EXISTS).
 *    Nothing is dropped, renamed or retyped, so a partial apply is recoverable
 *    by re-running.
 *  · Statements execute ONE AT A TIME — TiDB throws on combined ALTER clauses.
 *  · ADD COLUMN is not idempotent in TiDB, so each column is checked against
 *    information_schema first and skipped if present. Re-running is safe.
 *  · Verifies the end state by reading information_schema, not by trusting
 *    that the statements returned without error.
 *
 * Usage:
 *   node scripts/apply-0108-content-experiments.mjs            # dry run
 *   node scripts/apply-0108-content-experiments.mjs --apply    # execute
 */
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");

const url = readFileSync("C:/Users/nourd/NOURCITY/apps/nickstire/.env", "utf8")
  .split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="))
  ?.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");

const conn = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: true } });
const q = async (sql, args = []) => (await conn.execute(sql, args))[0];

const hasColumn = async (table, col) =>
  (await q(
    `SELECT COUNT(*) n FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, col],
  ))[0].n > 0;

const hasTable = async (table) =>
  (await q(
    `SELECT COUNT(*) n FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = ?`,
    [table],
  ))[0].n > 0;

console.log(`\n0108 content experiments · ${APPLY ? "APPLY" : "DRY RUN"}\n`);

/** Each step declares how to detect it is already done, so re-running is safe. */
const steps = [
  {
    name: "ig_metric_snapshots.avg_watch_time_ms",
    done: () => hasColumn("ig_metric_snapshots", "avg_watch_time_ms"),
    sql: "ALTER TABLE `ig_metric_snapshots` ADD COLUMN `avg_watch_time_ms` int NULL",
  },
  {
    name: "ig_metric_snapshots.skip_rate",
    done: () => hasColumn("ig_metric_snapshots", "skip_rate"),
    sql: "ALTER TABLE `ig_metric_snapshots` ADD COLUMN `skip_rate` decimal(6,4) NULL",
  },
  {
    name: "content_experiments",
    done: () => hasTable("content_experiments"),
    sql: `CREATE TABLE IF NOT EXISTS \`content_experiments\` (
  \`id\` int AUTO_INCREMENT PRIMARY KEY,
  \`experiment_id\` varchar(100) NOT NULL,
  \`primary_variable\` varchar(40) NOT NULL,
  \`objective\` varchar(20) NOT NULL,
  \`primary_metric\` varchar(60) NOT NULL,
  \`arms_json\` json NOT NULL,
  \`status\` varchar(20) NOT NULL DEFAULT 'running',
  \`started_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`concluded_at\` timestamp NULL,
  \`verdict_status\` varchar(24) NULL,
  \`verdict_note\` text NULL,
  UNIQUE KEY \`uk_content_experiment_id\` (\`experiment_id\`),
  KEY \`idx_content_exp_status\` (\`status\`)
)`,
  },
  {
    name: "content_experiment_assignments",
    done: () => hasTable("content_experiment_assignments"),
    sql: `CREATE TABLE IF NOT EXISTS \`content_experiment_assignments\` (
  \`id\` int AUTO_INCREMENT PRIMARY KEY,
  \`experiment_id\` varchar(100) NOT NULL,
  \`arm_id\` varchar(60) NOT NULL,
  \`episode_key\` varchar(160) NOT NULL,
  \`media_id\` varchar(100) NULL,
  \`reel_job_id\` int NULL,
  \`franchise_id\` varchar(60) NULL,
  \`cta_type\` varchar(20) NULL,
  \`content_origin\` varchar(30) NULL,
  \`posting_slot\` varchar(20) NULL,
  \`provider\` varchar(40) NULL,
  \`model\` varchar(80) NULL,
  \`prompt_version\` varchar(40) NULL,
  \`assigned_at\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`published_at\` timestamp NULL,
  UNIQUE KEY \`uk_exp_episode\` (\`experiment_id\`, \`episode_key\`),
  KEY \`idx_exp_assign_media\` (\`media_id\`),
  KEY \`idx_exp_assign_arm\` (\`experiment_id\`, \`arm_id\`)
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
for (const [table, col] of [
  ["ig_metric_snapshots", "avg_watch_time_ms"],
  ["ig_metric_snapshots", "skip_rate"],
]) {
  console.log(`  ${table}.${col}: ${(await hasColumn(table, col)) ? "PRESENT" : "MISSING"}`);
}
for (const t of ["content_experiments", "content_experiment_assignments"]) {
  console.log(`  table ${t}: ${(await hasTable(t)) ? "PRESENT" : "MISSING"}`);
}

if (!APPLY) console.log("\nDRY RUN — re-run with --apply to execute.\n");
else console.log(`\napplied ${executed} statement(s).\n`);

await conn.end();
