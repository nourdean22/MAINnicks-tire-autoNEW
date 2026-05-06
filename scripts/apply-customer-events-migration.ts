/**
 * One-shot migration applier for customer_events table.
 *
 * Why this exists: drizzle-kit's _journal.json drifted from production
 * — running `drizzle-kit migrate` tries to re-apply old migrations
 * that were already applied manually, hitting ER_TABLE_EXISTS_ERROR
 * on `users` (and others) before reaching the new migration.
 *
 * This script bypasses the journal and applies the customer_events
 * SQL directly. Idempotent (CREATE TABLE IF NOT EXISTS) — safe to
 * re-run.
 *
 * Run: npx tsx scripts/apply-customer-events-migration.ts
 */

import "dotenv/config";
import mysql from "mysql2/promise";

const SQL_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS \`customer_events\` (
    \`id\` int AUTO_INCREMENT NOT NULL,
    \`eventName\` varchar(64) NOT NULL,
    \`eventData\` json,
    \`sourcePage\` varchar(500),
    \`utmSource\` varchar(100),
    \`utmMedium\` varchar(100),
    \`utmCampaign\` varchar(255),
    \`referrer\` varchar(500),
    \`userAgent\` varchar(500),
    \`sessionId\` varchar(64),
    \`createdAt\` timestamp NOT NULL DEFAULT (now()),
    CONSTRAINT \`customer_events_id\` PRIMARY KEY(\`id\`)
  )`,
  `CREATE INDEX \`idx_customer_events_name_date\` ON \`customer_events\` (\`eventName\`, \`createdAt\`)`,
  `CREATE INDEX \`idx_customer_events_date\` ON \`customer_events\` (\`createdAt\`)`,
  `CREATE INDEX \`idx_customer_events_session\` ON \`customer_events\` (\`sessionId\`)`,
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");

  console.log("\n═══ APPLY customer_events MIGRATION ═══\n");
  const conn = await mysql.createConnection(url);

  try {
    // Check if table already exists for an early-out report
    const [existsRows] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'customer_events'",
    );
    const tableExists = (existsRows[0]?.n ?? 0) > 0;
    console.log(`customer_events table exists: ${tableExists ? "YES" : "no"}`);

    for (let i = 0; i < SQL_STATEMENTS.length; i++) {
      const sql = SQL_STATEMENTS[i];
      const summary = sql.split("\n")[0].slice(0, 80);
      try {
        await conn.query(sql);
        console.log(`  ✓ [${i + 1}/${SQL_STATEMENTS.length}] ${summary}`);
      } catch (err) {
        const code = (err as { code?: string }).code;
        // ER_DUP_KEYNAME = index already exists. Idempotent — fine.
        if (code === "ER_DUP_KEYNAME") {
          console.log(`  · [${i + 1}/${SQL_STATEMENTS.length}] index already exists, skipped`);
          continue;
        }
        throw err;
      }
    }

    // Verify
    const [verify] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'customer_events'",
    );
    const ok = (verify[0]?.n ?? 0) > 0;
    console.log(`\nFinal check — customer_events exists: ${ok ? "✓ YES" : "✗ NO (something failed)"}`);

    const [indexes] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT index_name FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'customer_events' GROUP BY index_name",
    );
    console.log(`Indexes on customer_events: ${indexes.map((r) => r.index_name).join(", ")}`);

    console.log("\n═══ DONE ═══");
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("\nFAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
