/**
 * One-shot apply for migration 0045 (wave-181.77 drip_enrollments
 * uq_drip_active UNIQUE INDEX). Pairs with the persistDripEnrollment
 * refactor that switches from FOR UPDATE to INSERT IGNORE.
 *
 * Idempotent · pre-check ensures the table exists + no duplicates
 * before adding the unique constraint. Pre-check + post-check + journal.
 *
 * Run: pnpm exec tsx scripts/apply-wave-181-77-drip-unique.ts
 */

import dotenv from "dotenv";
import { createHash } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import mysql from "mysql2/promise";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

const ROOT = process.cwd();
const MIGRATION_TAG = "0045_wave181_drip_enrollments_unique";
const MIGRATION_PATH = join(ROOT, "drizzle", `${MIGRATION_TAG}.sql`);
const JOURNAL_PATH = join(ROOT, "drizzle", "meta", "_journal.json");

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL missing");
  }

  console.log("\n═══ Wave-181.77 (0045) drip_enrollments uq_drip_active ═══\n");

  const conn = await mysql.createConnection(url);

  try {
    // Pre-check: does drip_enrollments table exist?
    const [tableExists] = await conn.query<mysql.RowDataPacket[]>(
      `SHOW TABLES LIKE 'drip_enrollments'`,
    );
    if (tableExists.length === 0) {
      console.log("  · drip_enrollments table does not exist yet · skipping (table created lazily by ensureTable on first call). Migration will re-apply on next run.");
      return;
    }

    // Pre-check: does the unique index already exist?
    const [existingIdx] = await conn.query<mysql.RowDataPacket[]>(
      `SHOW INDEX FROM drip_enrollments WHERE Key_name = 'uq_drip_active'`,
    );
    if (existingIdx.length > 0) {
      console.log("  · uq_drip_active already exists · idempotent no-op");
      return;
    }

    // Pre-check: any duplicate rows by (customerPhone, campaignId, status)?
    const [dupRows] = await conn.query<mysql.RowDataPacket[]>(`
      SELECT customerPhone, campaignId, status, COUNT(*) AS dup
      FROM drip_enrollments
      GROUP BY customerPhone, campaignId, status
      HAVING dup > 1
      LIMIT 5
    `);
    if (dupRows.length > 0) {
      console.error("  ❌ ABORT · existing duplicate rows would violate the unique constraint:");
      console.error(JSON.stringify(dupRows, null, 2));
      console.error("\n  Manual cleanup needed before applying this migration.");
      process.exit(2);
    }
    console.log("  · pre-check: zero duplicate rows · safe to add unique");

    const sql = readFileSync(MIGRATION_PATH, "utf8");
    const hash = createHash("sha256").update(sql).digest("hex");

    await conn.query(`CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash TEXT NOT NULL, created_at BIGINT)`);
    const [recordCheck] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT 1 FROM __drizzle_migrations WHERE hash = ? LIMIT 1`,
      [hash],
    );
    const alreadyRecorded = recordCheck.length > 0;

    const alterStatement = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--") && line.trim().length > 0)
      .join("\n")
      .trim();
    if (!alterStatement.toUpperCase().startsWith("ALTER TABLE")) {
      throw new Error(`Expected ALTER TABLE statement, got: ${alterStatement.slice(0, 80)}...`);
    }

    console.log("\nAPPLY:");
    const start = Date.now();
    await conn.query(alterStatement);
    console.log(`  ✓ applied in ${Date.now() - start}ms`);

    const [afterIdx] = await conn.query<mysql.RowDataPacket[]>(
      `SHOW INDEX FROM drip_enrollments WHERE Key_name = 'uq_drip_active'`,
    );
    if (afterIdx.length === 0) {
      throw new Error("POST-CHECK FAILED: uq_drip_active not present after ALTER");
    }
    const isUnique = (afterIdx[0] as { Non_unique: number }).Non_unique === 0;
    if (!isUnique) {
      throw new Error("POST-CHECK FAILED: uq_drip_active is not UNIQUE");
    }
    console.log(`\nAFTER:  uq_drip_active present + UNIQUE ✓`);

    if (!alreadyRecorded) {
      await conn.query(
        `INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`,
        [hash, Date.now()],
      );
      console.log("  ✓ hash recorded");
    }

    const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf8"));
    const tags = new Set<string>(journal.entries.map((e: { tag: string }) => e.tag));
    if (!tags.has(MIGRATION_TAG)) {
      const maxIdx = Math.max(...journal.entries.map((e: { idx: number }) => e.idx));
      journal.entries.push({
        idx: Math.max(maxIdx + 1, 45),
        version: "5",
        when: Date.now(),
        tag: MIGRATION_TAG,
        breakpoints: true,
      });
      writeFileSync(JOURNAL_PATH, JSON.stringify(journal, null, "\t") + "\n");
      console.log(`  ✓ journal entry added`);
    }

    console.log("\n═══ DONE — 0045 applied + verified ═══");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("\nFAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
