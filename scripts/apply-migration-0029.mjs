/**
 * One-off migration applier for 0029_alg_probe_log.
 *
 * Applies the SQL directly via mysql2 using the same DATABASE_URL the app uses.
 * Idempotent: checks for table existence before attempting CREATE.
 *
 * Usage: node --env-file=.env scripts/apply-migration-0029.mjs
 */

import mysql from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set in environment");
  process.exit(1);
}

const conn = await mysql.createConnection({ uri: DATABASE_URL });

try {
  const [existing] = await conn.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alg_probe_log'`,
  );
  if (Array.isArray(existing) && existing.length > 0) {
    console.log("✓ alg_probe_log already exists — skipping CREATE");
  } else {
    console.log("Creating alg_probe_log table...");
    await conn.query(`
      CREATE TABLE \`alg_probe_log\` (
        \`id\` int AUTO_INCREMENT NOT NULL,
        \`reason\` varchar(32) NOT NULL,
        \`detail\` varchar(200),
        \`outcome\` varchar(32) NOT NULL,
        \`recordsProcessed\` int NOT NULL DEFAULT 0,
        \`durationMs\` int NOT NULL DEFAULT 0,
        \`errorMessage\` text,
        \`startedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`completedAt\` timestamp NULL,
        CONSTRAINT \`alg_probe_log_id\` PRIMARY KEY(\`id\`)
      )
    `);
    console.log("✓ Table created");
  }

  const indexes = [
    { name: "idx_alg_probe_log_started", column: "startedAt" },
    { name: "idx_alg_probe_log_reason", column: "reason" },
    { name: "idx_alg_probe_log_outcome", column: "outcome" },
  ];

  for (const ix of indexes) {
    const [rows] = await conn.query(
      `SELECT INDEX_NAME FROM information_schema.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alg_probe_log' AND INDEX_NAME = ?`,
      [ix.name],
    );
    if (Array.isArray(rows) && rows.length > 0) {
      console.log(`✓ Index ${ix.name} already exists — skipping`);
    } else {
      console.log(`Creating index ${ix.name}...`);
      await conn.query(`CREATE INDEX \`${ix.name}\` ON \`alg_probe_log\` (\`${ix.column}\`)`);
      console.log(`✓ Index ${ix.name} created`);
    }
  }

  const [verify] = await conn.query("DESCRIBE alg_probe_log");
  console.log("\n--- alg_probe_log structure ---");
  for (const col of verify) {
    console.log(`  ${col.Field.padEnd(18)} ${col.Type.padEnd(20)} ${col.Null === "NO" ? "NOT NULL" : ""}`);
  }
  console.log("\n✓ Migration 0029 applied successfully");
} catch (err) {
  console.error("Migration failed:", err);
  process.exit(1);
} finally {
  await conn.end();
}
