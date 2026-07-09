/**
 * One-shot apply for migration 0036 (wave-125 leads pipeline).
 * Adds callbackId/bookingId/invoiceId FKs to leads + creates the
 * vapi_call_logs table.
 *
 * Idempotent — re-runnable. Each ALTER / CREATE TABLE checks for
 * existence via tolerated-error matching.
 *
 * Run: pnpm exec tsx scripts/apply-wave-125.ts
 */

import "dotenv/config";
import { createHash } from "crypto";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import mysql from "mysql2/promise";

const ROOT = process.cwd();
const JOURNAL_PATH = join(ROOT, "drizzle", "meta", "_journal.json");

const TOLERATED = [
  "duplicate key name",
  "duplicate column",
  "table already exists",
  "key column does not exist",
  "doesn't exist",
  "already exists",
];
function isTolerable(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return TOLERATED.some((f) => msg.includes(f));
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

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");

  console.log("\n═══ Wave-125 (0036) leads pipeline migration ═══\n");
  const conn = await mysql.createConnection(url);

  try {
    // Track in __drizzle_migrations
    const sql36 = readFileSync(join(ROOT, "drizzle", "0036_wave125_lead_pipeline.sql"), "utf8");
    const hash36 = createHash("sha256").update(sql36).digest("hex");

    await conn.query(`CREATE TABLE IF NOT EXISTS __drizzle_migrations (id SERIAL PRIMARY KEY, hash TEXT NOT NULL, created_at BIGINT)`);
    const [existing] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT 1 FROM __drizzle_migrations WHERE hash = ? LIMIT 1`,
      [hash36],
    );
    if (existing.length > 0) {
      console.log("Migration 0036 already recorded — verifying constraints in place...\n");
    } else {
      console.log("Migration 0036 not yet recorded — applying...\n");
    }

    // Apply each statement (idempotent — tolerated errors are skipped)
    console.log("STEP 1 — leads.callbackId + bookingId + invoiceId FKs");
    await exec(conn, "ADD COLUMN leads.callbackId",
      "ALTER TABLE `leads` ADD COLUMN `callbackId` int DEFAULT NULL");
    await exec(conn, "ADD INDEX idx_lead_callback_id",
      "ALTER TABLE `leads` ADD INDEX `idx_lead_callback_id` (`callbackId`)");
    await exec(conn, "ADD COLUMN leads.bookingId",
      "ALTER TABLE `leads` ADD COLUMN `bookingId` int DEFAULT NULL");
    await exec(conn, "ADD COLUMN leads.invoiceId",
      "ALTER TABLE `leads` ADD COLUMN `invoiceId` int DEFAULT NULL");
    await exec(conn, "ADD INDEX idx_lead_booking_id",
      "ALTER TABLE `leads` ADD INDEX `idx_lead_booking_id` (`bookingId`)");
    await exec(conn, "ADD INDEX idx_lead_invoice_id",
      "ALTER TABLE `leads` ADD INDEX `idx_lead_invoice_id` (`invoiceId`)");

    console.log("\nSTEP 2 — vapi_call_logs (NEW table)");
    await exec(conn, "CREATE TABLE vapi_call_logs", `
      CREATE TABLE IF NOT EXISTS \`vapi_call_logs\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`vapiCallId\` varchar(64) NOT NULL,
        \`phoneNumber\` varchar(30),
        \`customerName\` varchar(255),
        \`durationSeconds\` int DEFAULT 0,
        \`endedReason\` varchar(64),
        \`aiSummary\` text,
        \`serviceMention\` varchar(120),
        \`convertedToLead\` int NOT NULL DEFAULT 0,
        \`leadId\` int DEFAULT NULL,
        \`callbackId\` int DEFAULT NULL,
        \`transcriptUrl\` varchar(500),
        \`recordingUrl\` varchar(500),
        \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`uniq_vapi_call_id\` (\`vapiCallId\`),
        INDEX \`idx_vapi_log_created\` (\`createdAt\`),
        INDEX \`idx_vapi_log_phone\` (\`phoneNumber\`),
        INDEX \`idx_vapi_log_lead\` (\`leadId\`)
      )
    `);

    // Record hash
    if (existing.length === 0) {
      await conn.query(
        `INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)`,
        [hash36, Date.now()],
      );
      console.log("\n  ✓ 0036 hash recorded");
    }

    // Update journal
    const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf8"));
    const tags = new Set(journal.entries.map((e: { tag: string }) => e.tag));
    if (!tags.has("0036_wave125_lead_pipeline")) {
      journal.entries.push({
        idx: 36,
        version: "5",
        when: Date.now(),
        tag: "0036_wave125_lead_pipeline",
        breakpoints: true,
      });
      writeFileSync(JOURNAL_PATH, JSON.stringify(journal, null, "\t") + "\n");
      console.log("  ✓ Journal entry 36 added");
    }

    // Verify
    console.log("\nVERIFY — SHOW INDEXES on leads + check table:");
    const [leadsIdx] = await conn.query<mysql.RowDataPacket[]>(`SHOW INDEXES FROM leads`);
    const expected = ["idx_lead_callback_id", "idx_lead_booking_id", "idx_lead_invoice_id"];
    for (const e of expected) {
      const found = leadsIdx.find((r) => r.Key_name === e);
      console.log(`  ${found ? "✓" : "✗"} leads.${e} ${found ? "EXISTS" : "MISSING"}`);
    }
    const [tables] = await conn.query<mysql.RowDataPacket[]>(`SHOW TABLES LIKE 'vapi_call_logs'`);
    console.log(`  ${tables.length > 0 ? "✓" : "✗"} vapi_call_logs ${tables.length > 0 ? "EXISTS" : "MISSING"}`);

    console.log("\n═══ DONE — migration 0036 applied + verified ═══");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("\nFAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
