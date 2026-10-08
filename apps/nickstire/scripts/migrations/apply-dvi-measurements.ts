/**
 * Hand-apply migration 0143 — DVI measurements, multiple photos, post-work
 * verification. Seven additive nullable columns on inspection_items.
 *
 * Idempotent: each ADD COLUMN runs only if INFORMATION_SCHEMA says the column
 * is absent, and the table is proven to exist before any ALTER is attempted
 * (2026-09-02: the first apply of 0114 failed on a table no migration had
 * ever created). Re-running is a no-op. Records the file hash in
 * __drizzle_migrations so the reconcile gate sees it as applied.
 *
 * Run from apps/nickstire, with the production connection injected by Railway:
 *   railway run --service MAINnicks-tire-auto -- pnpm exec tsx scripts/migrations/apply-dvi-measurements.ts
 *
 * Writes to the production database — operator approval first (AGENTS.md,
 * Protected operations). Read .claude/skills/prod-db-guard/SKILL.md.
 */
import dotenv from "dotenv";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join, resolve } from "path";
import mysql from "mysql2/promise";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

const MIGRATION_TAG = "0143_dvi_measurements_verification";
const MIGRATION_PATH = join(process.cwd(), "drizzle", `${MIGRATION_TAG}.sql`);
const TABLE = "inspection_items";
const COLUMNS: Array<{ name: string; ddl: string }> = [
  { name: "measurementsJson", ddl: "ALTER TABLE inspection_items ADD COLUMN measurementsJson JSON NULL" },
  { name: "photoUrlsJson", ddl: "ALTER TABLE inspection_items ADD COLUMN photoUrlsJson JSON NULL" },
  { name: "verifiedAt", ddl: "ALTER TABLE inspection_items ADD COLUMN verifiedAt TIMESTAMP NULL" },
  { name: "verifiedBy", ddl: "ALTER TABLE inspection_items ADD COLUMN verifiedBy VARCHAR(255) NULL" },
  { name: "verificationNote", ddl: "ALTER TABLE inspection_items ADD COLUMN verificationNote VARCHAR(500) NULL" },
  { name: "verificationPhotoUrlsJson", ddl: "ALTER TABLE inspection_items ADD COLUMN verificationPhotoUrlsJson JSON NULL" },
  { name: "verificationMeasurementsJson", ddl: "ALTER TABLE inspection_items ADD COLUMN verificationMeasurementsJson JSON NULL" },
];

async function columnExists(connection: mysql.Connection, name: string): Promise<boolean> {
  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1",
    [TABLE, name],
  );
  return rows.length === 1;
}

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
    const [tables] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1",
      [TABLE],
    );
    if (tables.length !== 1) throw new Error(`PRE-CHECK FAILED: table ${TABLE} does not exist in this database`);

    let applied = 0;
    let skipped = 0;
    for (const col of COLUMNS) {
      if (await columnExists(connection, col.name)) {
        skipped++;
        continue;
      }
      await connection.query(col.ddl);
      applied++;
    }

    for (const col of COLUMNS) {
      if (!(await columnExists(connection, col.name))) throw new Error(`POST-CHECK FAILED: ${TABLE}.${col.name} missing`);
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

    console.log(`${MIGRATION_TAG}: ${applied} columns added, ${skipped} already present — all ${COLUMNS.length} verified`);
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error(`${MIGRATION_TAG} FAILED:`, err instanceof Error ? err.message : err);
  process.exit(1);
});
