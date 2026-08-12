/**
 * apply-0110-activity-ledger.mjs · hand-applied migration runner
 *
 * The generic runner is NOT usable here: it marks migrations tracked WITHOUT
 * executing them (the 0083-0087 trap, recorded in 0106). Every hand-applied
 * migration in this repo gets its own runner that executes, then VERIFIES.
 *
 * SAFETY
 *  · DRY RUN by default. --apply to execute.
 *  · Every statement is additive (ADD COLUMN / ADD UNIQUE KEY), each guarded
 *    by information_schema so re-running is a no-op. Nothing is dropped,
 *    renamed or retyped; a partial apply is recoverable by re-running.
 *  · Verifies the end state by reading information_schema, not by trusting
 *    that the statements returned without error.
 *  · TiDB: one ALTER per statement — combined ALTERs are rejected.
 *
 * Usage:
 *   node scripts/apply-0110-activity-ledger.mjs            # dry run
 *   node scripts/apply-0110-activity-ledger.mjs --apply    # execute
 */
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");

const url = readFileSync("C:/Users/nourd/NOURCITY/apps/nickstire/.env", "utf8")
  .split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="))
  ?.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");

const conn = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: true } });
const q = async (sql, args = []) => (await conn.execute(sql, args))[0];

const hasColumn = async (table, column) =>
  (await q(
    `SELECT COUNT(*) n FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [table, column],
  ))[0].n > 0;

const hasIndex = async (table, indexName) =>
  (await q(
    `SELECT COUNT(*) n FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?`,
    [table, indexName],
  ))[0].n > 0;

console.log(`\n0110 audit_log activity-ledger columns · ${APPLY ? "APPLY" : "DRY RUN"}\n`);

/** Each step declares how to detect it is already done, so re-running is safe. */
const steps = [
  {
    name: "audit_log.actor_type",
    done: () => hasColumn("audit_log", "actor_type"),
    sql: "ALTER TABLE `audit_log` ADD COLUMN `actor_type` varchar(24) NULL",
  },
  {
    name: "audit_log.before_json",
    done: () => hasColumn("audit_log", "before_json"),
    sql: "ALTER TABLE `audit_log` ADD COLUMN `before_json` json NULL",
  },
  {
    name: "audit_log.after_json",
    done: () => hasColumn("audit_log", "after_json"),
    sql: "ALTER TABLE `audit_log` ADD COLUMN `after_json` json NULL",
  },
  {
    name: "audit_log.status",
    done: () => hasColumn("audit_log", "status"),
    sql: "ALTER TABLE `audit_log` ADD COLUMN `status` varchar(32) NOT NULL DEFAULT 'executed'",
  },
  {
    name: "audit_log.idempotency_key",
    done: () => hasColumn("audit_log", "idempotency_key"),
    sql: "ALTER TABLE `audit_log` ADD COLUMN `idempotency_key` varchar(191) NULL",
  },
  {
    name: "audit_log uniq_audit_idem",
    done: () => hasIndex("audit_log", "uniq_audit_idem"),
    sql: "ALTER TABLE `audit_log` ADD UNIQUE KEY `uniq_audit_idem` (`idempotency_key`)",
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
for (const col of ["actor_type", "before_json", "after_json", "status", "idempotency_key"]) {
  console.log(`  column audit_log.${col}: ${(await hasColumn("audit_log", col)) ? "PRESENT" : "MISSING"}`);
}
console.log(`  index uniq_audit_idem: ${(await hasIndex("audit_log", "uniq_audit_idem")) ? "PRESENT" : "MISSING"}`);

if (!APPLY) console.log("\nDRY RUN — re-run with --apply to execute.\n");
else console.log(`\napplied ${executed} statement(s).\n`);

await conn.end();
