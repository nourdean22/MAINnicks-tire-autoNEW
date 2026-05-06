/**
 * One-off migration applier for 0028_gbp_post_log.
 *
 * Applies the SQL directly via mysql2 using the same DATABASE_URL the app uses.
 * Idempotent: checks for table existence before attempting CREATE.
 *
 * Usage: node --env-file=.env scripts/apply-migration-0028.mjs
 *
 * Why a hand-rolled script instead of `drizzle-kit migrate`:
 * - We hand-wrote the SQL for clarity/control
 * - drizzle-kit migrate expects journal entries we haven't authored yet
 * - This is a single-table additive migration, lowest-risk possible
 */

import mysql from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set in environment");
  process.exit(1);
}

const conn = await mysql.createConnection({ uri: DATABASE_URL });

try {
  // Check if the table already exists (idempotent guard)
  const [existing] = await conn.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gbp_post_log'`,
  );
  if (Array.isArray(existing) && existing.length > 0) {
    console.log("✓ gbp_post_log already exists — skipping CREATE");
  } else {
    console.log("Creating gbp_post_log table...");
    await conn.query(`
      CREATE TABLE \`gbp_post_log\` (
        \`id\` int AUTO_INCREMENT NOT NULL,
        \`archetype\` varchar(20) NOT NULL,
        \`topicHash\` varchar(64) NOT NULL,
        \`postBody\` text NOT NULL,
        \`ctaType\` varchar(20) NOT NULL,
        \`ctaUrl\` varchar(500) NOT NULL,
        \`imageHint\` text,
        \`source\` varchar(20) NOT NULL DEFAULT 'cron',
        \`postedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT \`gbp_post_log_id\` PRIMARY KEY(\`id\`)
      )
    `);
    console.log("✓ Table created");
  }

  // Indexes — each is idempotent via the IF NOT EXISTS pattern
  const indexes = [
    { name: "idx_gbp_post_log_posted",    column: "postedAt" },
    { name: "idx_gbp_post_log_archetype", column: "archetype" },
    { name: "idx_gbp_post_log_topic",     column: "topicHash" },
  ];

  for (const ix of indexes) {
    const [rows] = await conn.query(
      `SELECT INDEX_NAME FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gbp_post_log' AND INDEX_NAME = ?`,
      [ix.name],
    );
    if (Array.isArray(rows) && rows.length > 0) {
      console.log(`✓ Index ${ix.name} already exists — skipping`);
    } else {
      console.log(`Creating index ${ix.name}...`);
      await conn.query(`CREATE INDEX \`${ix.name}\` ON \`gbp_post_log\` (\`${ix.column}\`)`);
      console.log(`✓ Index ${ix.name} created`);
    }
  }

  // Verify
  const [verify] = await conn.query("DESCRIBE gbp_post_log");
  console.log("\n--- gbp_post_log structure ---");
  for (const col of verify) {
    console.log(`  ${col.Field.padEnd(15)} ${col.Type.padEnd(20)} ${col.Null === "NO" ? "NOT NULL" : ""}`);
  }
  console.log("\n✓ Migration 0028 applied successfully");
} catch (err) {
  console.error("Migration failed:", err);
  process.exit(1);
} finally {
  await conn.end();
}
