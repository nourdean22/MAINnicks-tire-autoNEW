/**
 * One-shot apply for migration 0066 (admin-excellence wave · drop decorative
 * engine_* feature flags).
 *
 * The 19 engine_* flags were seeded but NO code ever called isEnabled() for
 * them — the intelligence engines run unconditionally, so the toggles implied
 * control that never existed (operator-confirmed: delete). They've been removed
 * from FLAG_DEFINITIONS (no longer re-seeded); this drops the existing rows.
 *
 * Idempotent — re-runnable (DELETE of already-absent rows is a 0-row no-op).
 *
 * Run (prod env injected by Railway):
 *   railway run --service MAINnicks-tire-auto pnpm exec tsx scripts/apply-0066-drop-engine-flags.ts
 *
 * Mirrors scripts/apply-wave-181-69-cron-alerts-fired.ts.
 */

import dotenv from "dotenv";
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join, resolve } from "path";
import mysql from "mysql2/promise";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

const ROOT = process.cwd();
const MIGRATION_TAG = "0066_drop_engine_flags";
const MIGRATION_PATH = join(ROOT, "drizzle", `${MIGRATION_TAG}.sql`);

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL missing (run via `railway run --service MAINnicks-tire-auto ...`)");
  }

  console.log("\n=== Migration 0066 · drop decorative engine_* feature flags ===\n");

  const conn = await mysql.createConnection(url);
  try {
    const [beforeRows] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM feature_flags WHERE `key` LIKE 'engine\\_%'",
    );
    const before = Number(beforeRows[0]?.n ?? 0);
    console.log(`BEFORE: ${before} engine_* rows present`);

    const sql = readFileSync(MIGRATION_PATH, "utf8");
    const hash = createHash("sha256").update(sql).digest("hex");

    await conn.query(
      "CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash TEXT NOT NULL, created_at BIGINT)",
    );
    const [recorded] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT 1 FROM __drizzle_migrations WHERE hash = ? LIMIT 1",
      [hash],
    );
    if (recorded.length > 0) {
      console.log("  · migration hash already recorded — applying DELETE again is a safe no-op");
    }

    // Strip `--` comment lines FIRST (a comment may contain a `;`), THEN split
    // on `;` into statements. Avoids breaking a statement at a semicolon that
    // lives inside a comment.
    const statements = sql
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n")
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const stmt of statements) {
      const [res] = await conn.query<mysql.ResultSetHeader>(stmt);
      console.log(`  · executed: affectedRows=${(res as mysql.ResultSetHeader).affectedRows ?? 0}`);
    }

    const [afterRows] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM feature_flags WHERE `key` LIKE 'engine\\_%'",
    );
    const after = Number(afterRows[0]?.n ?? 0);
    console.log(`AFTER:  ${after} engine_* rows present`);

    if (recorded.length === 0) {
      await conn.query("INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)", [
        hash,
        Date.now(),
      ]);
      console.log("  · recorded migration hash");
    }

    if (after !== 0) {
      throw new Error(`Expected 0 engine_* rows after migration, found ${after}`);
    }
    console.log(`\n✓ Migration 0066 applied — removed ${before} engine_* rows (now 0).\n`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("Migration 0066 FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
