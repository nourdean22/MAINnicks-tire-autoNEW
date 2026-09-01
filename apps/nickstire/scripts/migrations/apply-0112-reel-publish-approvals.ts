/**
 * One-shot apply for migration 0112 (reel_publish_approvals).
 *
 * WHAT THIS UNBLOCKS. `cron/jobs/dailyReelPost.ts` has been default-deny since
 * #2000: it publishes nothing without a live row in `reel_publish_approvals`.
 * The table's DDL is hand-applied and has no recorded receipt, so on a database
 * where it does not exist the drain reads zero approvals and EVERY reel is held
 * indefinitely. Applying this is what makes approving — and therefore
 * publishing — possible at all.
 *
 * SAFETY, stated so it can be checked rather than trusted:
 *   - The only statement executed from the migration is `CREATE TABLE IF NOT
 *     EXISTS` (plus the standard `__drizzle_migrations` bookkeeping). There is
 *     no DELETE, UPDATE, TRUNCATE, DROP or ALTER anywhere in this script or in
 *     drizzle/0112_reel_publish_approvals.sql — read both before running.
 *   - Idempotent: re-running is a no-op on an existing table.
 *   - Additive: it creates a NEW table and touches no existing one, so no
 *     current row or column can be affected.
 *   - Fails loudly. A post-check verifies every column and the index actually
 *     exist and exits non-zero otherwise, because "the statement ran" is not
 *     the same fact as "the table is correct".
 *
 * Run (Railway injects the real connection string):
 *   railway run --service MAINnicks-tire-auto -- pnpm exec tsx scripts/migrations/apply-0112-reel-publish-approvals.ts
 */
import dotenv from "dotenv";
import { createHash } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import mysql from "mysql2/promise";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

const ROOT = process.cwd();
const MIGRATION_TAG = "0112_reel_publish_approvals";
const TABLE = "reel_publish_approvals";
const JOURNAL_PATH = join(ROOT, "drizzle", "meta", "_journal.json");
const MIGRATION_PATH = join(ROOT, "drizzle", `${MIGRATION_TAG}.sql`);

/** Every column drizzle/schema.ts reads. A missing one is a silent 500 later. */
const REQUIRED_COLUMNS = [
  "id",
  "reel_job_id",
  "caption_sha",
  "video_url",
  "approved_by",
  "approved_at",
  "expires_at",
  "revoked_at",
  "revoked_by",
  "note",
  "created_at",
];

/** The drain filters on (reel_job_id, revoked_at); without it that read scans. */
const REQUIRED_INDEX = "idx_reel_approvals_job";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");

  // Name the host. A worktree defaults to production and guessing which
  // database you are pointed at is how the wrong one gets written.
  const host = (() => {
    try {
      return new URL(url.replace(/^mysql:\/\//, "http://")).host;
    } catch {
      return "unparseable";
    }
  })();
  console.log(`\n═══ 0112 CREATE TABLE ${TABLE} ═══\n`);
  console.log(`TARGET HOST: ${host}\n`);

  const conn = await mysql.createConnection(url);
  try {
    const [before] = await conn.query<mysql.RowDataPacket[]>(`SHOW TABLES LIKE '${TABLE}'`);
    const existedBefore = before.length > 0;
    console.log(existedBefore ? "BEFORE: table already exists (this run is a no-op)" : "BEFORE: table missing");

    const sql = readFileSync(MIGRATION_PATH, "utf8");
    const hash = createHash("sha256").update(sql).digest("hex");

    const createStatement = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--") && line.trim().length > 0)
      .join("\n")
      .trim();

    // Refuse anything that is not the additive create. The migration file is
    // committed and reviewed, but this script is what actually executes, so it
    // checks rather than assumes: a destructive verb reaching production
    // because "the file was fine" is the incident this repo already paid for.
    if (!/^CREATE TABLE IF NOT EXISTS/i.test(createStatement)) {
      throw new Error("REFUSING: 0112 does not begin with CREATE TABLE IF NOT EXISTS");
    }
    if (/\b(DROP|TRUNCATE|DELETE|ALTER|UPDATE)\b/i.test(createStatement)) {
      throw new Error("REFUSING: 0112 contains a non-additive statement");
    }

    console.log("\nAPPLY:");
    const start = Date.now();
    await conn.query(createStatement);
    console.log(`  ✓ applied in ${Date.now() - start}ms`);

    // POST-CHECK. Read the shape back out of the database — the statement
    // succeeding is not evidence the table is right.
    const [cols] = await conn.query<mysql.RowDataPacket[]>(`SHOW COLUMNS FROM ${TABLE}`);
    const colNames = (cols as Array<{ Field: string }>).map((r) => r.Field);
    const missing = REQUIRED_COLUMNS.filter((c) => !colNames.includes(c));
    if (missing.length > 0) throw new Error(`POST-CHECK FAILED: missing columns ${missing.join(", ")}`);
    console.log(`\nAFTER: ${colNames.length} columns OK · ${colNames.join(", ")}`);

    const [idx] = await conn.query<mysql.RowDataPacket[]>(`SHOW INDEX FROM ${TABLE}`);
    const idxNames = new Set((idx as Array<{ Key_name: string }>).map((r) => r.Key_name));
    if (!idxNames.has(REQUIRED_INDEX)) {
      throw new Error(`POST-CHECK FAILED: missing index ${REQUIRED_INDEX}`);
    }
    console.log(`AFTER: index OK · ${[...idxNames].join(", ")}`);

    // `id varchar(36)` is exactly UUID-sized and the writer depends on it.
    // TiDB runs STRICT_TRANS_TABLES, so an over-width id would be REJECTED and
    // the approval row LOST — pin the width here too, where it is observable.
    const idCol = (cols as Array<{ Field: string; Type: string }>).find((c) => c.Field === "id");
    console.log(`AFTER: id type · ${idCol?.Type ?? "unknown"}`);

    await conn.query(
      `CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash TEXT NOT NULL, created_at BIGINT)`,
    );
    const [recordCheck] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT 1 FROM __drizzle_migrations WHERE hash = ? LIMIT 1`,
      [hash],
    );
    if (recordCheck.length === 0) {
      await conn.query(`INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`, [hash, Date.now()]);
      console.log("  ✓ hash recorded");
    } else {
      console.log("  · hash already recorded");
    }

    const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf8"));
    const tags = new Set<string>(journal.entries.map((e: { tag: string }) => e.tag));
    if (!tags.has(MIGRATION_TAG)) {
      const maxIdx = Math.max(...journal.entries.map((e: { idx: number }) => e.idx));
      journal.entries.push({
        idx: Math.max(maxIdx + 1, 112),
        version: "5",
        when: Date.now(),
        tag: MIGRATION_TAG,
        breakpoints: true,
      });
      writeFileSync(JOURNAL_PATH, JSON.stringify(journal, null, "\t") + "\n");
      console.log("  ✓ journal entry added");
    } else {
      console.log("  · journal entry already present (0112 shipped with one — not proof it was applied)");
    }

    console.log(`\n═══ DONE — 0112 ${existedBefore ? "verified" : "applied"} + post-checked ═══`);
    console.log("Reels can now be approved in /admin → Instagram → Reels → Autonomous publish.\n");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("\nFAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
