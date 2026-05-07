/**
 * Wave-97 diagnostic — ALG probe log analysis.
 *
 * Reports recent probe history so we can see:
 *  - Are probes firing?
 *  - Are they succeeding?
 *  - Are they returning records?
 *  - What's the failure mode for the empty alg_estimates table?
 */
import "dotenv/config";
import mysql from "mysql2/promise";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL missing"); process.exit(1); }
  const conn = await mysql.createConnection(url);
  try {
    console.log("\n═══ ALG PROBE LOG ═══\n");

    const [recentRows] = await conn.execute(`
      SELECT startedAt, reason, outcome, recordsProcessed, durationMs,
             SUBSTRING(errorMessage, 1, 100) as err
      FROM alg_probe_log
      ORDER BY startedAt DESC
      LIMIT 20
    `);
    console.log("Last 20 probes:");
    console.table(recentRows);

    const [outcomeStats] = await conn.execute(`
      SELECT outcome, COUNT(*) as c, MAX(startedAt) as last
      FROM alg_probe_log
      WHERE startedAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY outcome ORDER BY c DESC
    `);
    console.log("\nLast 7d by outcome:");
    console.table(outcomeStats);

    const [emptyHistory] = await conn.execute(`
      SELECT outcome, COUNT(*) as c
      FROM alg_probe_log
      WHERE startedAt >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY outcome
    `);
    console.log("\nLast 30d by outcome:");
    console.table(emptyHistory);

    const [latestSuccess] = await conn.execute(`
      SELECT startedAt, recordsProcessed, durationMs
      FROM alg_probe_log
      WHERE outcome = 'success'
      ORDER BY startedAt DESC LIMIT 1
    `);
    console.log("\nMost recent successful probe:");
    console.table(latestSuccess);

    const [estCustomerSourceStats] = await conn.execute(`
      SELECT source, COUNT(*) as c FROM alg_estimates GROUP BY source
    `);
    console.log("\nalg_estimates by source:");
    console.table(estCustomerSourceStats);
  } finally {
    await conn.end();
  }
}

main().catch((err) => { console.error("Crashed:", err); process.exit(1); });
