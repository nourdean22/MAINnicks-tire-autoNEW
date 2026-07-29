/**
 * Hand-apply migration 0105 — sent_at dispatch timestamp on sms_messages
 * (Revenue Autopilot Wave 2).
 *
 * Idempotent: ADD COLUMN runs only if INFORMATION_SCHEMA says it is absent.
 * Additive nullable only — no data movement. Post-checked.
 *
 * Run from apps/nickstire:
 *   pnpm exec tsx scripts/migrations/apply-sms-sent-at.ts
 */
import dotenv from "dotenv";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join, resolve } from "path";
import mysql from "mysql2/promise";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

const MIGRATION_TAG = "0105_sms_sent_at";
const MIGRATION_PATH = join(process.cwd(), "drizzle", `${MIGRATION_TAG}.sql`);
const TABLE = "sms_messages";
const COLUMNS: Array<{ name: string; ddl: string }> = [
  { name: "sent_at", ddl: "ALTER TABLE sms_messages ADD COLUMN sent_at TIMESTAMP NULL" },
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

    console.log(`${MIGRATION_TAG}: ${applied} column added, ${skipped} already present — verified on ${TABLE}`);
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error(`${MIGRATION_TAG} FAILED:`, err instanceof Error ? err.message : err);
  process.exit(1);
});
