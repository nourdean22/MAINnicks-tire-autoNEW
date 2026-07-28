/**
 * Hand-apply migration 0101 — DVI customer decisions + view tracking.
 *
 * Idempotent: each ADD COLUMN runs only if INFORMATION_SCHEMA says the
 * column is absent. Additive nullable columns (plus a defaulted counter)
 * on the two existing inspection tables — no data movement.
 *
 * Run from apps/nickstire:
 *   pnpm exec tsx scripts/migrations/apply-dvi-decisions.ts
 */
import dotenv from "dotenv";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join, resolve } from "path";
import mysql from "mysql2/promise";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

const MIGRATION_TAG = "0101_dvi_decisions";
const MIGRATION_PATH = join(process.cwd(), "drizzle", `${MIGRATION_TAG}.sql`);
const COLUMNS: Array<{ table: string; name: string; ddl: string }> = [
  { table: "vehicle_inspections", name: "firstViewedAt", ddl: "ALTER TABLE vehicle_inspections ADD COLUMN firstViewedAt TIMESTAMP NULL" },
  { table: "vehicle_inspections", name: "viewCount", ddl: "ALTER TABLE vehicle_inspections ADD COLUMN viewCount INT NOT NULL DEFAULT 0" },
  { table: "inspection_items", name: "decision", ddl: "ALTER TABLE inspection_items ADD COLUMN decision VARCHAR(16) NULL" },
  { table: "inspection_items", name: "decisionAt", ddl: "ALTER TABLE inspection_items ADD COLUMN decisionAt TIMESTAMP NULL" },
  { table: "inspection_items", name: "customerNote", ddl: "ALTER TABLE inspection_items ADD COLUMN customerNote VARCHAR(500) NULL" },
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
        [col.table, col.name],
      );
      if (rows.length === 1) {
        skipped++;
        continue;
      }
      await connection.query(col.ddl);
      applied++;
    }

    for (const col of COLUMNS) {
      const [rows] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1",
        [col.table, col.name],
      );
      if (rows.length !== 1) throw new Error(`POST-CHECK FAILED: ${col.table}.${col.name} missing`);
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

    console.log(`${MIGRATION_TAG}: ${applied} columns added, ${skipped} already present — all 5 verified`);
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error(`${MIGRATION_TAG} FAILED:`, err instanceof Error ? err.message : err);
  process.exit(1);
});
