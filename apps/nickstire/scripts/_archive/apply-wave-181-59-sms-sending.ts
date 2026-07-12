/**
 * One-shot apply for migration 0041 (wave-181.59 sms_messages.status
 * enum gains "sending"). Pairs with the rehydrate fix in
 * server/sms.ts:215+ — see drizzle/0041_wave181_sms_sending_status.sql
 * for full context.
 *
 * Idempotent — re-runnable. ALTER MODIFY COLUMN sets the enum to the
 * same shape on subsequent runs.
 *
 * Loads .env from the REPO ROOT (apps/nickstire has no .env of its own;
 * deploys read from Railway env, and local dev reads from ../../.env).
 *
 * Run: pnpm exec tsx scripts/apply-wave-181-59-sms-sending.ts
 */

import dotenv from "dotenv";
import { createHash } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import mysql from "mysql2/promise";

// Load root .env (two levels up from apps/nickstire)
dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

const ROOT = process.cwd();
const MIGRATION_TAG = "0041_wave181_sms_sending_status";
const MIGRATION_PATH = join(ROOT, "drizzle", `${MIGRATION_TAG}.sql`);
const JOURNAL_PATH = join(ROOT, "drizzle", "meta", "_journal.json");

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL missing (looked in apps/nickstire/.env and ../../.env)");
  }

  console.log("\n═══ Wave-181.59 (0041) sms_messages.status += 'sending' ═══\n");

  const conn = await mysql.createConnection(url);

  try {
    // ── Pre-check: read current enum shape so we can confirm the apply ──
    const [beforeRows] = await conn.query<mysql.RowDataPacket[]>(
      `SHOW COLUMNS FROM sms_messages WHERE Field = 'status'`,
    );
    if (beforeRows.length === 0) throw new Error("sms_messages.status column not found");
    const beforeType = beforeRows[0].Type as string;
    console.log(`BEFORE: ${beforeType}`);

    const alreadyHasSending = beforeType.includes("'sending'");
    if (alreadyHasSending) {
      console.log("  · enum already contains 'sending' — apply is a no-op");
    }

    // ── Apply the migration ──
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    const hash = createHash("sha256").update(sql).digest("hex");

    await conn.query(`CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash TEXT NOT NULL, created_at BIGINT)`);
    const [existing] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT 1 FROM __drizzle_migrations WHERE hash = ? LIMIT 1`,
      [hash],
    );
    const alreadyRecorded = existing.length > 0;
    console.log(alreadyRecorded ? "  · hash already recorded in __drizzle_migrations" : "  · hash not yet recorded — will record after apply");

    // Run only the ALTER (skip comments). The file has a single statement.
    const alterStatement = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--") && line.trim().length > 0)
      .join("\n")
      .trim();
    if (!alterStatement.toUpperCase().startsWith("ALTER TABLE")) {
      throw new Error(`Expected ALTER TABLE statement at start, got: ${alterStatement.slice(0, 60)}...`);
    }

    console.log("\nAPPLY:");
    console.log(`  ${alterStatement.replace(/\s+/g, " ")}`);
    const start = Date.now();
    await conn.query(alterStatement);
    console.log(`  ✓ applied in ${Date.now() - start}ms`);

    // ── Post-check: confirm 'sending' is now in the enum ──
    const [afterRows] = await conn.query<mysql.RowDataPacket[]>(
      `SHOW COLUMNS FROM sms_messages WHERE Field = 'status'`,
    );
    const afterType = afterRows[0].Type as string;
    console.log(`\nAFTER:  ${afterType}`);
    if (!afterType.includes("'sending'")) {
      throw new Error("POST-CHECK FAILED: 'sending' not found in enum after ALTER");
    }
    console.log("  ✓ 'sending' is now a valid status value");

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
        idx: Math.max(maxIdx + 1, 41),
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

    console.log("\n═══ DONE — 0041 applied + verified ═══");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("\nFAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
