/**
 * One-shot apply for migration 0061 (wave-181.x Service Affinity v2).
 * Creates 4 closed-loop tables · predictions / impressions / actions /
 * outcomes. See drizzle/0061_service_affinity_v2.sql for full schema.
 *
 * Idempotent — re-runnable. CREATE TABLE IF NOT EXISTS is a no-op if
 * the tables already exist (does NOT verify the schema matches; the
 * schema is fixed at the SQL file level so drift can only happen if
 * someone manually altered the prod tables).
 *
 * Loads DATABASE_URL from (in order):
 *   1. Process env (preferred · `DATABASE_URL=... pnpm tsx ...`)
 *   2. ../../.env (repo root)
 *   3. ../../../../.env (one level up from the repo root)
 *
 * Run options:
 *   · From local: DATABASE_URL=mysql://... pnpm exec tsx scripts/apply-wave-181-sa-v2.ts
 *   · From Railway: railway run -- pnpm exec tsx scripts/apply-wave-181-sa-v2.ts
 *   · From repo root with .env: pnpm --filter @nicks-tire-auto/web exec tsx scripts/apply-wave-181-sa-v2.ts
 */

import dotenv from "dotenv";
import { createHash } from "crypto";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import mysql from "mysql2/promise";

// Try multiple .env locations so the script works from local + Railway + repo-root checkout
const ENV_CANDIDATES = [
  resolve(process.cwd(), ".env"),
  resolve(process.cwd(), "..", "..", ".env"),
  resolve(process.cwd(), "..", "..", "..", ".env"),
];
for (const p of ENV_CANDIDATES) {
  if (existsSync(p)) {
    dotenv.config({ path: p });
    break;
  }
}

const ROOT = process.cwd();
const MIGRATION_TAG = "0061_service_affinity_v2";
const MIGRATION_PATH = join(ROOT, "drizzle", `${MIGRATION_TAG}.sql`);
const JOURNAL_PATH = join(ROOT, "drizzle", "meta", "_journal.json");

const EXPECTED_TABLES = [
  "service_affinity_predictions",
  "prediction_impressions",
  "prediction_actions",
  "prediction_outcomes",
];

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL missing · set it inline (DATABASE_URL=... pnpm tsx scripts/...) or " +
      "via Railway (railway run -- pnpm tsx scripts/...) or via a .env file at repo root.",
    );
  }

  console.log("\n═══ Wave-181.x SA v2 (0061) · 4 closed-loop tables ═══\n");

  const conn = await mysql.createConnection(url);

  try {
    // ── Pre-check: how many of the 4 tables already exist? ──
    const beforeExists: Record<string, boolean> = {};
    for (const t of EXPECTED_TABLES) {
      const [rows] = await conn.query<mysql.RowDataPacket[]>(`SHOW TABLES LIKE '${t}'`);
      beforeExists[t] = rows.length > 0;
    }
    console.log("BEFORE:");
    for (const t of EXPECTED_TABLES) {
      console.log(`  · ${t}: ${beforeExists[t] ? "exists" : "missing"}`);
    }

    // ── Apply ──
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    const hash = createHash("sha256").update(sql).digest("hex");

    await conn.query(
      `CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash TEXT NOT NULL, created_at BIGINT)`,
    );
    const [existing] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT 1 FROM __drizzle_migrations WHERE hash = ? LIMIT 1`,
      [hash],
    );
    const alreadyRecorded = existing.length > 0;
    console.log(
      alreadyRecorded
        ? "  · hash already recorded in __drizzle_migrations"
        : "  · hash not yet recorded — will record after apply",
    );

    // Split on semicolons + filter to CREATE TABLE statements
    // (the .sql file has 4 CREATE TABLE IF NOT EXISTS blocks + comments)
    const statements = sql
      .split(/;\s*\n/) // statement-ending semicolons on their own line(s)
      .map((s) => {
        // strip SQL comments line by line
        return s
          .split("\n")
          .filter((line) => !line.trim().startsWith("--"))
          .join("\n")
          .trim();
      })
      .filter((s) => s.length > 0 && s.toUpperCase().includes("CREATE TABLE"));

    if (statements.length !== EXPECTED_TABLES.length) {
      throw new Error(
        `Expected ${EXPECTED_TABLES.length} CREATE TABLE statements, parsed ${statements.length}`,
      );
    }

    console.log("\nAPPLY:");
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      const start = Date.now();
      await conn.query(stmt);
      console.log(`  ✓ statement ${i + 1}/${statements.length} applied in ${Date.now() - start}ms`);
    }

    // ── Post-check: confirm all 4 tables exist + have expected columns ──
    console.log("\nAFTER:");
    for (const t of EXPECTED_TABLES) {
      const [rows] = await conn.query<mysql.RowDataPacket[]>(`SHOW TABLES LIKE '${t}'`);
      const exists = rows.length > 0;
      console.log(`  · ${t}: ${exists ? "EXISTS" : "MISSING"}`);
      if (!exists) {
        throw new Error(`POST-CHECK FAILED: ${t} not created`);
      }
    }

    // Spot-check the predictions table has the ab_arm column
    const [colsRows] = await conn.query<mysql.RowDataPacket[]>(
      `SHOW COLUMNS FROM service_affinity_predictions`,
    );
    const colNames = (colsRows as Array<{ Field: string }>).map((r) => r.Field);
    const required = ["customer_id", "predicted_service", "confidence", "ab_arm", "model_version"];
    const missing = required.filter((c) => !colNames.includes(c));
    if (missing.length > 0) {
      throw new Error(
        `POST-CHECK FAILED: service_affinity_predictions missing columns ${missing.join(", ")}`,
      );
    }
    console.log(`  · columns OK · ${colNames.join(", ")}`);

    // ── Record hash + journal ──
    if (!alreadyRecorded) {
      await conn.query(
        `INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`,
        [hash, Date.now()],
      );
      console.log("\n  ✓ hash recorded in __drizzle_migrations");
    }

    if (existsSync(JOURNAL_PATH)) {
      const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf8"));
      const tags = new Set<string>(journal.entries.map((e: { tag: string }) => e.tag));
      if (!tags.has(MIGRATION_TAG)) {
        const maxIdx = Math.max(...journal.entries.map((e: { idx: number }) => e.idx));
        journal.entries.push({
          idx: Math.max(maxIdx + 1, 61),
          version: "5",
          when: Date.now(),
          tag: MIGRATION_TAG,
          breakpoints: true,
        });
        writeFileSync(JOURNAL_PATH, JSON.stringify(journal, null, "\t") + "\n");
        console.log(`  ✓ journal entry added (tag=${MIGRATION_TAG})`);
      } else {
        console.log(`  · journal already has tag=${MIGRATION_TAG}`);
      }
    }

    console.log("\n═══ DONE — 0061 applied + verified · 4 tables live ═══\n");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("\nFAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
