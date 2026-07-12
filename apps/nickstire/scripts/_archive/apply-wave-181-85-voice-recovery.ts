/**
 * One-shot apply for migration 0049 (wave-181.85 voice_recovery columns
 * on alg_estimates). Idempotent · adds only missing columns.
 *
 * Run: pnpm exec tsx scripts/apply-wave-181-85-voice-recovery.ts
 */
import dotenv from "dotenv";
import { createHash } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import mysql from "mysql2/promise";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

const ROOT = process.cwd();
const MIGRATION_TAG = "0049_wave181_voice_recovery";
const JOURNAL_PATH = join(ROOT, "drizzle", "meta", "_journal.json");
const MIGRATION_PATH = join(ROOT, "drizzle", `${MIGRATION_TAG}.sql`);

const NEW_COLUMNS = ["voice_recovery_attempted_at", "voice_recovery_call_id", "voice_recovery_outcome"];

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");

  console.log("\n═══ Wave-181.85 (0049) alg_estimates += voice_recovery_* ═══\n");
  const conn = await mysql.createConnection(url);
  try {
    const [colRows] = await conn.query<mysql.RowDataPacket[]>(`SHOW COLUMNS FROM alg_estimates`);
    const existing = new Set((colRows as Array<{ Field: string }>).map((r) => r.Field));
    const missing = NEW_COLUMNS.filter((c) => !existing.has(c));
    const present = NEW_COLUMNS.filter((c) => existing.has(c));

    console.log(`BEFORE: present=${present.length} missing=${missing.length}`);
    if (present.length > 0) console.log(`  · already have: ${present.join(", ")}`);

    if (missing.length === 0) {
      console.log("  · nothing to add · all 3 target columns already present");
    } else {
      const start = Date.now();
      for (const col of missing) {
        let ddl: string;
        if (col === "voice_recovery_attempted_at") {
          ddl = `ALTER TABLE alg_estimates ADD COLUMN \`${col}\` TIMESTAMP NULL AFTER \`follow_up_30d_attempted_at\``;
        } else if (col === "voice_recovery_call_id") {
          ddl = `ALTER TABLE alg_estimates ADD COLUMN \`${col}\` VARCHAR(64) NULL AFTER \`voice_recovery_attempted_at\``;
        } else {
          ddl = `ALTER TABLE alg_estimates ADD COLUMN \`${col}\` ENUM('pending','dialing','interested','not_interested','no_answer','failed') NULL AFTER \`voice_recovery_call_id\``;
        }
        console.log(`  · ${ddl}`);
        await conn.query(ddl);
      }
      console.log(`  ✓ added ${missing.length} columns in ${Date.now() - start}ms`);
    }

    // Verify
    const [afterRows] = await conn.query<mysql.RowDataPacket[]>(`SHOW COLUMNS FROM alg_estimates`);
    const finalCols = new Set((afterRows as Array<{ Field: string }>).map((r) => r.Field));
    const stillMissing = NEW_COLUMNS.filter((c) => !finalCols.has(c));
    if (stillMissing.length > 0) throw new Error(`POST-CHECK FAILED: still missing ${stillMissing.join(", ")}`);
    console.log(`\nAFTER: all ${NEW_COLUMNS.length} columns present ✓`);

    // Record + journal
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    const hash = createHash("sha256").update(sql).digest("hex");
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
      journal.entries.push({ idx: Math.max(maxIdx + 1, 49), version: "5", when: Date.now(), tag: MIGRATION_TAG, breakpoints: true });
      writeFileSync(JOURNAL_PATH, JSON.stringify(journal, null, "\t") + "\n");
      console.log(`  ✓ journal entry added`);
    }
    console.log("\n═══ DONE — 0049 applied + verified ═══");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("\nFAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
