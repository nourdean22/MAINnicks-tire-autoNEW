/**
 * Diagnostic — why are 2,427 SMS failing in the last 7d?
 *
 * Read-only. Surfaces failure patterns + sample bodies + recent
 * timestamps so the operator can triage F25e vs Twilio vs config.
 */
import dotenv from "dotenv";
import { resolve } from "path";
import mysql from "mysql2/promise";

dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

async function main(): Promise<void> {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    // 1. Time distribution — is this a recent spike or steady-state?
    const [byDay] = await conn.query(`
      SELECT
        DATE(\`createdAt\`) AS day,
        SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) AS sent,
        SUM(CASE WHEN status='delivered' THEN 1 ELSE 0 END) AS delivered,
        SUM(CASE WHEN status='queued' THEN 1 ELSE 0 END) AS queued
      FROM sms_messages
      WHERE \`createdAt\` > NOW() - INTERVAL 7 DAY
      GROUP BY DATE(\`createdAt\`)
      ORDER BY day DESC
    `);

    // 2. Sample failed message bodies — pattern recognition
    const [samples] = await conn.query(`
      SELECT \`createdAt\`, LEFT(body, 80) AS body_preview, variantKey
      FROM sms_messages
      WHERE status='failed' AND \`createdAt\` > NOW() - INTERVAL 7 DAY
      ORDER BY \`createdAt\` DESC
      LIMIT 10
    `);

    // 3. Failures grouped by variantKey — which crons are failing?
    const [byVariant] = await conn.query(`
      SELECT
        COALESCE(variantKey, '<null>') AS variant,
        COUNT(*) AS failed_count,
        MIN(\`createdAt\`) AS first_seen,
        MAX(\`createdAt\`) AS last_seen
      FROM sms_messages
      WHERE status='failed' AND \`createdAt\` > NOW() - INTERVAL 7 DAY
      GROUP BY COALESCE(variantKey, '<null>')
      ORDER BY failed_count DESC
    `);

    // 4. Most-recent successful send — is the system working at all?
    const [recentSuccess] = await conn.query(`
      SELECT \`createdAt\`, LEFT(body, 60) AS body_preview, status
      FROM sms_messages
      WHERE status IN ('sent', 'delivered') AND \`createdAt\` > NOW() - INTERVAL 7 DAY
      ORDER BY \`createdAt\` DESC
      LIMIT 5
    `);

    console.log("\n═══ SMS failure diagnostic — last 7d ═══\n");
    console.log("[1] Failure rate by day:");
    console.log(JSON.stringify(byDay, null, 2));
    console.log("\n[2] Sample failed message bodies (most recent 10):");
    console.log(JSON.stringify(samples, null, 2));
    console.log("\n[3] Failures by variantKey (which crons):");
    console.log(JSON.stringify(byVariant, null, 2));
    console.log("\n[4] Most-recent successful sends:");
    console.log(JSON.stringify(recentSuccess, null, 2));
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
