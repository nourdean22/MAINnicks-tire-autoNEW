/**
 * One-shot apply for migration 0044 (wave-181.69 cron_alerts_fired table).
 * Pairs with server/cron/jobs/vapiLatencySync.ts alert-dedup refactor.
 * See drizzle/0044_wave181_cron_alerts_fired.sql for full context.
 *
 * Idempotent — re-runnable. CREATE TABLE IF NOT EXISTS is a no-op if
 * the table already exists.
 *
 * Mirrors apply-wave-181-59-otp-attempts.ts — same pattern, sister bug.
 *
 * Loads .env from the REPO ROOT (apps/nickstire has no .env of its own;
 * deploys read from Railway env, and local dev reads from ../../.env).
 *
 * Run: pnpm exec tsx scripts/apply-wave-181-69-cron-alerts-fired.ts
 */

import dotenv from "dotenv";
import { createHash } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import mysql from "mysql2/promise";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

const ROOT = process.cwd();
const MIGRATION_TAG = "0044_wave181_cron_alerts_fired";
const MIGRATION_PATH = join(ROOT, "drizzle", `${MIGRATION_TAG}.sql`);
const JOURNAL_PATH = join(ROOT, "drizzle", "meta", "_journal.json");

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL missing (looked in apps/nickstire/.env and ../../.env)");
  }

  console.log("\n═══ Wave-181.69 (0044) CREATE TABLE cron_alerts_fired ═══\n");

  const conn = await mysql.createConnection(url);

  try {
    const [beforeRows] = await conn.query<mysql.RowDataPacket[]>(
      `SHOW TABLES LIKE 'cron_alerts_fired'`,
    );
    const alreadyExists = beforeRows.length > 0;
    console.log(alreadyExists ? "BEFORE: table exists" : "BEFORE: table missing");

    const sql = readFileSync(MIGRATION_PATH, "utf8");
    const hash = createHash("sha256").update(sql).digest("hex");

    await conn.query(`CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash TEXT NOT NULL, created_at BIGINT)`);
    const [existing] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT 1 FROM __drizzle_migrations WHERE hash = ? LIMIT 1`,
      [hash],
    );
    const alreadyRecorded = existing.length > 0;
    console.log(alreadyRecorded ? "  · hash already recorded" : "  · hash not recorded — will record after apply");

    const createStatement = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--") && line.trim().length > 0)
      .join("\n")
      .trim();
    if (!createStatement.toUpperCase().includes("CREATE TABLE")) {
      throw new Error(`Expected CREATE TABLE statement, got: ${createStatement.slice(0, 80)}...`);
    }

    console.log("\nAPPLY:");
    const start = Date.now();
    await conn.query(createStatement);
    console.log(`  ✓ applied in ${Date.now() - start}ms`);

    const [columnsRows] = await conn.query<mysql.RowDataPacket[]>(
      `SHOW COLUMNS FROM cron_alerts_fired`,
    );
    const columnNames = (columnsRows as Array<{ Field: string }>).map((r) => r.Field);
    const required = ["alert_key", "fired_for", "fired_at", "payload"];
    const missing = required.filter((c) => !columnNames.includes(c));
    if (missing.length > 0) {
      throw new Error(`POST-CHECK FAILED: missing columns ${missing.join(", ")}`);
    }
    console.log(`\nAFTER:  columns OK · ${columnNames.join(", ")}`);

    if (!alreadyRecorded) {
      await conn.query(
        `INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`,
        [hash, Date.now()],
      );
      console.log("  ✓ hash recorded in __drizzle_migrations");
    }

    const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf8"));
    const tags = new Set<string>(journal.entries.map((e: { tag: string }) => e.tag));
    if (!tags.has(MIGRATION_TAG)) {
      const maxIdx = Math.max(...journal.entries.map((e: { idx: number }) => e.idx));
      journal.entries.push({
        idx: Math.max(maxIdx + 1, 44),
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

    console.log("\n═══ DONE — 0044 applied + verified ═══");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("\nFAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
