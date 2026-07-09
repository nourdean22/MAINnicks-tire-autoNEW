/**
 * One-shot apply for migration 0047 (wave-181.83 cron_tier_skip_state).
 * Idempotent (CREATE TABLE IF NOT EXISTS).
 *
 * Run: pnpm exec tsx scripts/apply-wave-181-83-tier-skip-state.ts
 */
import dotenv from "dotenv";
import { createHash } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import mysql from "mysql2/promise";

dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

const ROOT = process.cwd();
const MIGRATION_TAG = "0047_wave181_cron_tier_skip_state";
const JOURNAL_PATH = join(ROOT, "drizzle", "meta", "_journal.json");
const MIGRATION_PATH = join(ROOT, "drizzle", `${MIGRATION_TAG}.sql`);

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");

  console.log("\n═══ Wave-181.83 (0047) CREATE TABLE cron_tier_skip_state ═══\n");
  const conn = await mysql.createConnection(url);
  try {
    const [before] = await conn.query<mysql.RowDataPacket[]>(`SHOW TABLES LIKE 'cron_tier_skip_state'`);
    console.log(before.length > 0 ? "BEFORE: table exists" : "BEFORE: table missing");

    const sql = readFileSync(MIGRATION_PATH, "utf8");
    const hash = createHash("sha256").update(sql).digest("hex");

    const createStatement = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--") && line.trim().length > 0)
      .join("\n")
      .trim();

    console.log("\nAPPLY:");
    const start = Date.now();
    await conn.query(createStatement);
    console.log(`  ✓ applied in ${Date.now() - start}ms`);

    const [verifyCols] = await conn.query<mysql.RowDataPacket[]>(`SHOW COLUMNS FROM cron_tier_skip_state`);
    const colNames = (verifyCols as Array<{ Field: string }>).map((r) => r.Field);
    const required = ["tier_name", "consecutive_skips", "last_skip_at", "last_run_at", "updated_at"];
    const missing = required.filter((c) => !colNames.includes(c));
    if (missing.length > 0) throw new Error(`POST-CHECK FAILED: missing columns ${missing.join(", ")}`);
    console.log(`\nAFTER: columns OK · ${colNames.join(", ")}`);

    await conn.query(`CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash TEXT NOT NULL, created_at BIGINT)`);
    const [recordCheck] = await conn.query<mysql.RowDataPacket[]>(`SELECT 1 FROM __drizzle_migrations WHERE hash = ? LIMIT 1`, [hash]);
    if (recordCheck.length === 0) {
      await conn.query(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`, [hash, Date.now()]);
      console.log("  ✓ hash recorded");
    }
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf8"));
    const tags = new Set<string>(journal.entries.map((e: { tag: string }) => e.tag));
    if (!tags.has(MIGRATION_TAG)) {
      const maxIdx = Math.max(...journal.entries.map((e: { idx: number }) => e.idx));
      journal.entries.push({ idx: Math.max(maxIdx + 1, 47), version: "5", when: Date.now(), tag: MIGRATION_TAG, breakpoints: true });
      writeFileSync(JOURNAL_PATH, JSON.stringify(journal, null, "\t") + "\n");
      console.log(`  ✓ journal entry added`);
    }
    console.log("\n═══ DONE — 0047 applied + verified ═══");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("\nFAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
