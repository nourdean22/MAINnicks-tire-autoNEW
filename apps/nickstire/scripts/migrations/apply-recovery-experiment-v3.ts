/**
 * Hand-apply migration 0103 — Recovery Experiment v3 version + assignment-time columns.
 *
 * Idempotent by construction: each ADD COLUMN runs ONLY if
 * INFORMATION_SCHEMA says the column is absent (plain ALTERs in the SQL
 * file would error on re-run; the journal covers fresh envs, this script
 * covers prod). Additive nullable columns only — no data movement.
 *
 * Run from apps/nickstire:
 *   pnpm exec tsx scripts/migrations/apply-recovery-experiment-v3.ts
 */
import dotenv from "dotenv";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join, resolve } from "path";
import mysql from "mysql2/promise";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

const MIGRATION_TAG = "0103_recovery_experiment_v3";
const MIGRATION_PATH = join(process.cwd(), "drizzle", `${MIGRATION_TAG}.sql`);
const TABLE = "alg_estimates";
const COLUMNS: Array<{ name: string; ddl: string }> = [
  { name: "recovery_experiment_version", ddl: "ALTER TABLE alg_estimates ADD COLUMN recovery_experiment_version VARCHAR(8) NULL" },
  { name: "recovery_assigned_at", ddl: "ALTER TABLE alg_estimates ADD COLUMN recovery_assigned_at TIMESTAMP NULL" },
];

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  if (!url.startsWith("mysql://")) {
    throw new Error(
      `DATABASE_URL is not a mysql:// connection string (got "${url.split("://")[0]}://..."). ` +
        "This migration targets Nick's Tire's TiDB/MySQL database, not statenour's Postgres. " +
        "Refusing to run against the wrong database.",
    );
  }

  const source = readFileSync(MIGRATION_PATH, "utf8");
  const hash = createHash("sha256").update(source).digest("hex");
  const connection = await mysql.createConnection(url);

  try {
    let applied = 0;
    let skipped = 0;
    for (const col of COLUMNS) {
      const [rows] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1",
        [TABLE, col.name],
      );
      if (rows.length === 1) {
        skipped++;
        continue;
      }
      await connection.query(col.ddl);
      applied++;
    }

    // Post-check: every column must now exist.
    for (const col of COLUMNS) {
      const [rows] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1",
        [TABLE, col.name],
      );
      if (rows.length !== 1) throw new Error(`POST-CHECK FAILED: ${TABLE}.${col.name} missing`);
    }

    await connection.query(
      "CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash TEXT NOT NULL, created_at BIGINT)",
    );
    const [recorded] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT 1 FROM __drizzle_migrations WHERE hash = ? LIMIT 1",
      [hash],
    );
    if (recorded.length === 0) {
      await connection.query("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)", [hash, Date.now()]);
    }

    console.log(`${MIGRATION_TAG}: ${applied} columns added, ${skipped} already present — all ${COLUMNS.length} verified on ${TABLE}`);
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error(`${MIGRATION_TAG} FAILED:`, err instanceof Error ? err.message : err);
  process.exit(1);
});
