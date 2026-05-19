/**
 * One-shot apply for migration 0042 (wave-181.59 alg_estimates
 * follow_up_{7,30}d_attempted_at columns). Pairs with the at-most-once
 * claim in server/cron/jobs/declinedWorkRecovery.ts.
 * See drizzle/0042_wave181_declined_recovery_attempted_at.sql for context.
 *
 * Idempotent — re-runnable. Checks column existence before running
 * ALTER (MySQL ADD COLUMN errors if the column already exists).
 *
 * Run: pnpm exec tsx scripts/apply-wave-181-59-declined-recovery-attempted.ts
 */

import dotenv from "dotenv";
import { createHash } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import mysql from "mysql2/promise";

dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

const ROOT = process.cwd();
const MIGRATION_TAG = "0042_wave181_declined_recovery_attempted_at";
const MIGRATION_PATH = join(ROOT, "drizzle", `${MIGRATION_TAG}.sql`);
const JOURNAL_PATH = join(ROOT, "drizzle", "meta", "_journal.json");

const NEW_COLUMNS = ["follow_up_7d_attempted_at", "follow_up_30d_attempted_at"];

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL missing (looked in apps/nickstire/.env and ../../.env)");
  }

  console.log("\n═══ Wave-181.59 (0042) alg_estimates += AttemptedAt cols ═══\n");

  const conn = await mysql.createConnection(url);

  try {
    // ── Pre-check: which of the new columns already exist? ──
    const [colRows] = await conn.query<mysql.RowDataPacket[]>(
      `SHOW COLUMNS FROM alg_estimates`,
    );
    const existingCols = new Set((colRows as Array<{ Field: string }>).map((r) => r.Field));
    const missing = NEW_COLUMNS.filter((c) => !existingCols.has(c));
    const present = NEW_COLUMNS.filter((c) => existingCols.has(c));
    console.log(`BEFORE: present=${present.length} missing=${missing.length}`);
    if (present.length > 0) console.log(`  · already have: ${present.join(", ")}`);
    if (missing.length === 0) {
      console.log("  · nothing to add — all target columns present");
    }

    const sql = readFileSync(MIGRATION_PATH, "utf8");
    const hash = createHash("sha256").update(sql).digest("hex");

    await conn.query(`CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash TEXT NOT NULL, created_at BIGINT)`);
    const [existing] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT 1 FROM __drizzle_migrations WHERE hash = ? LIMIT 1`,
      [hash],
    );
    const alreadyRecorded = existing.length > 0;
    console.log(alreadyRecorded ? "  · hash already recorded" : "  · hash not recorded — will record after apply");

    // ── Apply (only the missing columns to keep it idempotent) ──
    if (missing.length > 0) {
      const start = Date.now();
      // ADD COLUMN x AFTER y — order matches the migration file for safety.
      // Run each ADD COLUMN as its own statement so a partial pre-state
      // (one column added, one missing) doesn't fail the second add.
      for (const col of missing) {
        const afterCol = col === "follow_up_7d_attempted_at" ? "follow_up_7d_sent" : "follow_up_30d_sent";
        console.log(`  · ADD COLUMN ${col} TIMESTAMP NULL AFTER ${afterCol}`);
        await conn.query(`ALTER TABLE alg_estimates ADD COLUMN \`${col}\` TIMESTAMP NULL AFTER \`${afterCol}\``);
      }
      console.log(`  ✓ applied ${missing.length} column(s) in ${Date.now() - start}ms`);
    }

    // ── Post-check ──
    const [afterRows] = await conn.query<mysql.RowDataPacket[]>(
      `SHOW COLUMNS FROM alg_estimates`,
    );
    const finalCols = new Set((afterRows as Array<{ Field: string }>).map((r) => r.Field));
    const stillMissing = NEW_COLUMNS.filter((c) => !finalCols.has(c));
    if (stillMissing.length > 0) {
      throw new Error(`POST-CHECK FAILED: still missing ${stillMissing.join(", ")}`);
    }
    console.log(`\nAFTER:  all ${NEW_COLUMNS.length} target columns present`);

    // ── Record hash + journal ──
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
        idx: Math.max(maxIdx + 1, 42),
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

    console.log("\n═══ DONE — 0042 applied + verified ═══");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("\nFAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
