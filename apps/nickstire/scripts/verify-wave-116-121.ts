/**
 * Post-apply verification for migrations 0034 + 0035. Run after
 * apply-wave-116-121.ts to confirm the constraints/indexes actually
 * landed on the live DB.
 *
 * Run: pnpm exec tsx scripts/verify-wave-116-121.ts
 */

import "dotenv/config";
import mysql from "mysql2/promise";

interface IndexRow {
  Table: string;
  Key_name: string;
  Column_name: string;
  Non_unique: number;
}

async function showIndexes(conn: mysql.Connection, table: string): Promise<IndexRow[]> {
  const [rows] = await conn.query<mysql.RowDataPacket[]>(`SHOW INDEXES FROM \`${table}\``);
  return rows as IndexRow[];
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");

  const conn = await mysql.createConnection(url);
  try {
    console.log("\n═══ POST-APPLY VERIFICATION ═══\n");

    // 0034 — customers UNIQUE on phone
    console.log("0034: customers.phone uniqueness");
    const cust = await showIndexes(conn, "customers");
    const uniq = cust.find((r) => r.Key_name === "uniq_customer_phone");
    const oldIdx = cust.find((r) => r.Key_name === "idx_customer_phone");
    if (uniq) {
      console.log(`  ✓ uniq_customer_phone EXISTS (Non_unique=${uniq.Non_unique}, expected 0)`);
      if (uniq.Non_unique !== 0) console.log(`  ⚠  WARNING: index is not actually unique!`);
    } else {
      console.log(`  ✗ uniq_customer_phone MISSING`);
    }
    if (oldIdx) console.log(`  ⚠  idx_customer_phone still exists (should have been dropped)`);
    else console.log(`  ✓ idx_customer_phone dropped`);

    // 0035 — 3 perf indexes
    console.log("\n0035: perf indexes");
    for (const [table, expected] of [
      ["customer_metrics", "idx_cm_customer_id"],
      ["callback_requests", "idx_callback_status"],
      ["customer_notifications", "idx_notification_status"],
    ] as const) {
      const idx = await showIndexes(conn, table);
      const hit = idx.find((r) => r.Key_name === expected);
      if (hit) console.log(`  ✓ ${table}.${expected} EXISTS on column "${hit.Column_name}"`);
      else console.log(`  ✗ ${table}.${expected} MISSING`);
    }

    // Tracking table
    console.log("\n__drizzle_migrations recorded hashes:");
    const [migs] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS n FROM __drizzle_migrations`,
    );
    console.log(`  ${migs[0].n} total migration hashes tracked`);

    console.log("\n═══ VERIFICATION COMPLETE ═══");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
