/**
 * One-shot apply for migration 0046 (wave-181.83 sms_conversations
 * .phone_normalized generated column + index).
 *
 * Idempotent · pre-checks column existence before ALTER · pre-checks
 * index existence before CREATE.
 *
 * Run: pnpm exec tsx scripts/apply-wave-181-83-phone-normalized.ts
 */
import dotenv from "dotenv";
import { createHash } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import mysql from "mysql2/promise";

dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

const ROOT = process.cwd();
const MIGRATION_TAG = "0046_wave181_sms_conv_phone_normalized";
const JOURNAL_PATH = join(ROOT, "drizzle", "meta", "_journal.json");
const MIGRATION_PATH = join(ROOT, "drizzle", `${MIGRATION_TAG}.sql`);

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");

  console.log("\n═══ Wave-181.83 (0046) sms_conversations.phone_normalized ═══\n");
  const conn = await mysql.createConnection(url);
  try {
    // wave-181.83 final · TiDB expression index · no column needed.
    const [idxExists] = await conn.query<mysql.RowDataPacket[]>(
      `SHOW INDEX FROM sms_conversations WHERE Key_name = 'idx_sms_conv_phone_norm'`,
    );
    if (idxExists.length > 0) {
      console.log("  · idx_sms_conv_phone_norm already exists · skipping CREATE INDEX");
    } else {
      console.log("  · idx_sms_conv_phone_norm missing · creating expression index (chained REPLACE · allowed by default in TiDB)");
      const start = Date.now();
      // Mirror the exact expression smsInstrumentation.ts uses at lines
      // 71 + 134 so the planner can rewrite. REGEXP_REPLACE is blocked
      // by TiDB's default expression-index safety list · the chained
      // REPLACE pattern is allowed.
      await conn.query(`CREATE INDEX \`idx_sms_conv_phone_norm\` ON \`sms_conversations\` ((RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(\`phone\`, '-', ''), ' ', ''), '(', ''), ')', ''), 10)))`);
      console.log(`  ✓ CREATE INDEX in ${Date.now() - start}ms`);
    }

    const [verifyIdx] = await conn.query<mysql.RowDataPacket[]>(
      `SHOW INDEX FROM sms_conversations WHERE Key_name = 'idx_sms_conv_phone_norm'`,
    );
    if (verifyIdx.length === 0) throw new Error("POST-CHECK FAILED: idx_sms_conv_phone_norm not present");
    console.log("\nAFTER: expression index present ✓");

    // Record + journal
    const sql = readFileSync(MIGRATION_PATH, "utf8");
    const hash = createHash("sha256").update(sql).digest("hex");
    await conn.query(`CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash TEXT NOT NULL, created_at BIGINT)`);
    const [recordCheck] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT 1 FROM __drizzle_migrations WHERE hash = ? LIMIT 1`,
      [hash],
    );
    if (recordCheck.length === 0) {
      await conn.query(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`, [hash, Date.now()]);
      console.log("  ✓ hash recorded");
    }
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf8"));
    const tags = new Set<string>(journal.entries.map((e: { tag: string }) => e.tag));
    if (!tags.has(MIGRATION_TAG)) {
      const maxIdx = Math.max(...journal.entries.map((e: { idx: number }) => e.idx));
      journal.entries.push({ idx: Math.max(maxIdx + 1, 46), version: "5", when: Date.now(), tag: MIGRATION_TAG, breakpoints: true });
      writeFileSync(JOURNAL_PATH, JSON.stringify(journal, null, "\t") + "\n");
      console.log(`  ✓ journal entry added`);
    }
    console.log("\n═══ DONE — 0046 applied + verified ═══");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("\nFAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
