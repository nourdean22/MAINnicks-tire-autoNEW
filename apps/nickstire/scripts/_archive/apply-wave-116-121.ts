/**
 * One-shot apply for migrations 0034 (customer.phone unique) + 0035
 * (perf indexes). Operator-authorized end-to-end:
 *
 *   1. AUDIT — find duplicate customer.phone groups (read-only)
 *   2. MERGE — for each dup group, keep MIN(id), COALESCE fields up,
 *      DELETE later rows. (Destructive — operator authorized.)
 *   3. APPLY 0034 — ADD UNIQUE KEY uniq_customer_phone, DROP redundant
 *      idx_customer_phone
 *   4. APPLY 0035 — 3 perf indexes (idempotent: skip if already exist)
 *   5. RECORD — register hashes in __drizzle_migrations + add journal
 *      entries so future drizzle-kit migrate sees these as applied
 *
 * Run: pnpm exec tsx scripts/apply-wave-116-121.ts
 *
 * Idempotent — safe to re-run. Each step checks current state before
 * acting and skips if already done.
 */

import "dotenv/config";
import { createHash } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import mysql from "mysql2/promise";

const ROOT = process.cwd();
const JOURNAL_PATH = join(ROOT, "drizzle", "meta", "_journal.json");

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

function loadSql(tag: string): string {
  return readFileSync(join(ROOT, "drizzle", `${tag}.sql`), "utf8");
}
function migrationHash(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

const TOLERATED_FRAGMENTS = [
  "duplicate key name",
  "duplicate column",
  "key column does not exist",
  "doesn't exist",
  "already exists",
];
function isTolerable(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return TOLERATED_FRAGMENTS.some((f) => msg.includes(f));
}

async function exec(conn: mysql.Connection, label: string, sql: string): Promise<"applied" | "skipped"> {
  try {
    await conn.query(sql);
    console.log(`  ✓ ${label}`);
    return "applied";
  } catch (err) {
    if (isTolerable(err)) {
      console.log(`  · ${label} — already in place (skipped)`);
      return "skipped";
    }
    console.error(`  ✗ ${label} — FAILED:`, err instanceof Error ? err.message : err);
    throw err;
  }
}

async function ensureTrackingTable(conn: mysql.Connection): Promise<void> {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash TEXT NOT NULL,
      created_at BIGINT
    )
  `);
}
async function isHashApplied(conn: mysql.Connection, hash: string): Promise<boolean> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT 1 FROM __drizzle_migrations WHERE hash = ? LIMIT 1`,
    [hash],
  );
  return rows.length > 0;
}
async function recordApplied(conn: mysql.Connection, hash: string, whenMs: number): Promise<void> {
  await conn.query(
    `INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`,
    [hash, whenMs],
  );
}

async function auditDuplicatePhones(conn: mysql.Connection): Promise<{ dupGroups: number; affectedRows: number; sample: Array<{ phone: string; ids: string }> }> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(`
    SELECT phone, COUNT(*) AS dupes, GROUP_CONCAT(id ORDER BY id) AS ids
    FROM customers
    WHERE phone IS NOT NULL AND phone != ''
    GROUP BY phone
    HAVING dupes > 1
    ORDER BY dupes DESC
    LIMIT 50
  `);
  const dupGroups = rows.length;
  const affectedRows = rows.reduce((sum, r) => sum + (Number(r.dupes) - 1), 0);
  const sample = rows.slice(0, 5).map((r) => ({
    phone: String(r.phone),
    ids: String(r.ids),
  }));
  return { dupGroups, affectedRows, sample };
}

async function mergeDuplicates(conn: mysql.Connection): Promise<number> {
  // For each dup group: keep MIN(id), copy non-null fields from later
  // rows up onto the keeper, then DELETE the later rows.
  // Two-statement approach (UPDATE then DELETE) so the transaction is
  // simple and the JOIN target is consistent.
  console.log("  → COALESCING fields onto keeper rows…");
  await conn.query(`
    UPDATE customers c1
      JOIN (
        SELECT phone, MIN(id) AS keep_id
        FROM customers
        WHERE phone IS NOT NULL AND phone != ''
        GROUP BY phone
        HAVING COUNT(*) > 1
      ) keepers ON c1.phone = keepers.phone AND c1.id = keepers.keep_id
      JOIN customers c2 ON c2.phone = c1.phone AND c2.id > c1.id
      SET
        c1.email      = COALESCE(c1.email,      c2.email),
        c1.address    = COALESCE(c1.address,    c2.address),
        c1.city       = COALESCE(c1.city,       c2.city),
        c1.state      = COALESCE(c1.state,      c2.state),
        c1.zip        = COALESCE(c1.zip,        c2.zip),
        c1.lastName   = COALESCE(c1.lastName,   c2.lastName),
        c1.totalSpent = GREATEST(c1.totalSpent, c2.totalSpent),
        c1.totalVisits= GREATEST(c1.totalVisits, c2.totalVisits),
        c1.notes      = COALESCE(c1.notes,      c2.notes)
  `);
  console.log("  → DELETING later duplicate rows…");
  const [result] = await conn.query<mysql.ResultSetHeader>(`
    DELETE c2 FROM customers c2
      JOIN (
        SELECT phone, MIN(id) AS keep_id
        FROM customers
        WHERE phone IS NOT NULL AND phone != ''
        GROUP BY phone
        HAVING COUNT(*) > 1
      ) keepers ON c2.phone = keepers.phone
      WHERE c2.id > keepers.keep_id
  `);
  return result.affectedRows;
}

async function apply0034(conn: mysql.Connection): Promise<void> {
  await exec(conn, "ADD UNIQUE KEY uniq_customer_phone (phone)",
    "ALTER TABLE `customers` ADD UNIQUE KEY `uniq_customer_phone` (`phone`)");
  await exec(conn, "DROP INDEX idx_customer_phone (now redundant)",
    "ALTER TABLE `customers` DROP INDEX `idx_customer_phone`");
}
async function apply0035(conn: mysql.Connection): Promise<void> {
  await exec(conn, "ADD INDEX idx_cm_customer_id ON customer_metrics",
    "ALTER TABLE `customer_metrics` ADD INDEX `idx_cm_customer_id` (`customerId`)");
  await exec(conn, "ADD INDEX idx_callback_status ON callback_requests",
    "ALTER TABLE `callback_requests` ADD INDEX `idx_callback_status` (`status`)");
  await exec(conn, "ADD INDEX idx_notification_status ON customer_notifications",
    "ALTER TABLE `customer_notifications` ADD INDEX `idx_notification_status` (`status`)");
}

function updateJournal(): void {
  const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf8"));
  const existingTags = new Set(journal.entries.map((e: JournalEntry) => e.tag));
  const newEntries: JournalEntry[] = [];
  if (!existingTags.has("0034_wave116_customer_phone_unique")) {
    newEntries.push({
      idx: 34,
      version: "5",
      when: Date.now() - 1000, // slightly before 0035
      tag: "0034_wave116_customer_phone_unique",
      breakpoints: true,
    });
  }
  if (!existingTags.has("0035_wave121_perf_indexes")) {
    newEntries.push({
      idx: 35,
      version: "5",
      when: Date.now(),
      tag: "0035_wave121_perf_indexes",
      breakpoints: true,
    });
  }
  if (newEntries.length === 0) {
    console.log("\nJournal already current.");
    return;
  }
  journal.entries.push(...newEntries);
  writeFileSync(JOURNAL_PATH, JSON.stringify(journal, null, "\t") + "\n");
  console.log(`\nJournal updated with ${newEntries.length} new entries.`);
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing — check .env");

  console.log("\n═══ Wave-116 + Wave-121 migration apply ═══\n");

  const conn = await mysql.createConnection(url);
  try {
    await ensureTrackingTable(conn);

    // ─── STEP 1: Audit duplicate phones ──────────────────────────
    console.log("STEP 1 — Auditing customer.phone duplicates…");
    const audit = await auditDuplicatePhones(conn);
    if (audit.dupGroups === 0) {
      console.log("  ✓ Zero duplicate phone groups — clean dataset");
    } else {
      console.log(`  ⚠  Found ${audit.dupGroups} duplicate phone groups affecting ${audit.affectedRows} rows`);
      console.log(`     Sample (top 5):`);
      for (const s of audit.sample) {
        const masked = s.phone.replace(/\D/g, "").slice(-4);
        console.log(`       phone …${masked} → ids ${s.ids}`);
      }
    }

    // ─── STEP 2: Merge duplicates if any ─────────────────────────
    if (audit.dupGroups > 0) {
      console.log("\nSTEP 2 — Merging duplicates (operator-authorized)…");
      const deleted = await mergeDuplicates(conn);
      console.log(`  ✓ Merged ${audit.dupGroups} groups, removed ${deleted} duplicate rows`);
      const post = await auditDuplicatePhones(conn);
      if (post.dupGroups !== 0) {
        throw new Error(`Dedup incomplete — ${post.dupGroups} groups remain. Aborting.`);
      }
      console.log("  ✓ Re-audit clean");
    } else {
      console.log("\nSTEP 2 — Skipping merge (no duplicates)");
    }

    // ─── STEP 3: Apply migration 0034 ────────────────────────────
    console.log("\nSTEP 3 — Applying 0034 (customer.phone unique)…");
    const sql34 = loadSql("0034_wave116_customer_phone_unique");
    const hash34 = migrationHash(sql34);
    if (await isHashApplied(conn, hash34)) {
      console.log("  · Already recorded in __drizzle_migrations — skipping");
    } else {
      await apply0034(conn);
      await recordApplied(conn, hash34, Date.now() - 1000);
      console.log("  ✓ 0034 hash recorded");
    }

    // ─── STEP 4: Apply migration 0035 ────────────────────────────
    console.log("\nSTEP 4 — Applying 0035 (perf indexes)…");
    const sql35 = loadSql("0035_wave121_perf_indexes");
    const hash35 = migrationHash(sql35);
    if (await isHashApplied(conn, hash35)) {
      console.log("  · Already recorded — skipping");
    } else {
      await apply0035(conn);
      await recordApplied(conn, hash35, Date.now());
      console.log("  ✓ 0035 hash recorded");
    }

    // ─── STEP 5: Update journal ──────────────────────────────────
    console.log("\nSTEP 5 — Updating drizzle journal…");
    updateJournal();

    console.log("\n═══ DONE — both migrations applied ═══");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("\nFAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
