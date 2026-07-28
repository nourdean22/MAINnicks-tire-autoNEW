/**
 * Hand-apply migration 0102 — Customer Promise Ledger.
 * Idempotent: CREATE TABLE IF NOT EXISTS + post-check + hash record.
 *
 * Run from apps/nickstire:
 *   pnpm exec tsx scripts/migrations/apply-customer-promises.ts
 */
import dotenv from "dotenv";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join, resolve } from "path";
import mysql from "mysql2/promise";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

const MIGRATION_TAG = "0102_customer_promises";
const MIGRATION_PATH = join(process.cwd(), "drizzle", `${MIGRATION_TAG}.sql`);
const REQUIRED_TABLES = ["customer_promises"];

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
  const statements = source
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
  const hash = createHash("sha256").update(source).digest("hex");
  const connection = await mysql.createConnection(url);

  try {
    for (const statement of statements) {
      await connection.query(statement);
    }

    for (const table of REQUIRED_TABLES) {
      const [rows] = await connection.query<mysql.RowDataPacket[]>("SHOW TABLES LIKE ?", [table]);
      if (rows.length !== 1) throw new Error(`POST-CHECK FAILED: ${table} missing`);
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

    console.log(`${MIGRATION_TAG} applied and verified: ${REQUIRED_TABLES.join(", ")}`);
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error(`${MIGRATION_TAG} FAILED:`, err instanceof Error ? err.message : err);
  process.exit(1);
});
