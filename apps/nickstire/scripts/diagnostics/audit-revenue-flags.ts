/**
 * wave-181.80 · audit all revenue-cron feature flags · find what else
 * is gated like FEATURE_DECLINED_RECOVERY was. The big finding of this
 * session was that declined-recovery has been dry-running for months
 * because nobody set the env flag — same pattern might be hiding in
 * cross-sell + retention + winback crons.
 */
import dotenv from "dotenv";
import { resolve } from "path";
import mysql from "mysql2/promise";

dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

const conn = await mysql.createConnection(process.env.DATABASE_URL!);
try {
  console.log("\n═══ DB feature flags (featureFlags service) ═══\n");
  try {
    const [flags] = await conn.query(
      `SELECT \`key\`, enabled, updated_at FROM feature_flags ORDER BY \`key\``,
    );
    console.log(JSON.stringify(flags, null, 2));
  } catch (e) {
    console.log(`  (feature_flags table query failed: ${e instanceof Error ? e.message : String(e)})`);
  }

  console.log("\n═══ Recent cron_log status by job (last 7d) ═══\n");
  try {
    const [logs] = await conn.query(`
      SELECT job_name,
        COUNT(*) AS runs,
        SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed,
        SUM(records_processed) AS total_records,
        MAX(started_at) AS last_run
      FROM cron_log
      WHERE started_at > NOW() - INTERVAL 7 DAY
        AND (job_name LIKE 'declined%' OR job_name LIKE '%cross%' OR job_name LIKE 'retention%' OR job_name LIKE '%winback%' OR job_name LIKE '%stale%')
      GROUP BY job_name
      ORDER BY job_name
    `);
    console.log(JSON.stringify(logs, null, 2));
  } catch (e) {
    console.log(`  (cron_log query failed: ${e instanceof Error ? e.message : String(e)})`);
  }

  console.log("\n═══ Recovery pipeline sizing ═══\n");
  // Backlog by age window · what we'd send if all crons were unleashed
  const [decl] = await conn.query(`
    SELECT
      COUNT(*) AS total,
      ROUND(SUM(estimated_amount) / 100, 2) AS total_dollars,
      SUM(CASE WHEN estimate_date > NOW() - INTERVAL 14 DAY AND estimate_date <= NOW() - INTERVAL 7 DAY AND follow_up_7d_sent = 0 THEN 1 ELSE 0 END) AS d7_eligible,
      SUM(CASE WHEN estimate_date > NOW() - INTERVAL 60 DAY AND estimate_date <= NOW() - INTERVAL 30 DAY AND follow_up_30d_sent = 0 THEN 1 ELSE 0 END) AS d30_eligible
    FROM alg_estimates
    WHERE matched_invoice_id IS NULL
      AND customer_phone IS NOT NULL AND customer_phone != ''
      AND estimate_date > NOW() - INTERVAL 60 DAY
  `);
  console.log("Declined-recovery (60d window):");
  console.log(JSON.stringify(decl, null, 2));

  // Retention candidates · customers who haven't been back in N days
  const [retention] = await conn.query(`
    SELECT
      SUM(CASE WHEN last_visit_date > NOW() - INTERVAL 8 DAY AND last_visit_date <= NOW() - INTERVAL 7 DAY THEN 1 ELSE 0 END) AS d7_candidates,
      SUM(CASE WHEN last_visit_date > NOW() - INTERVAL 15 DAY AND last_visit_date <= NOW() - INTERVAL 14 DAY THEN 1 ELSE 0 END) AS d14_candidates,
      SUM(CASE WHEN last_visit_date > NOW() - INTERVAL 31 DAY AND last_visit_date <= NOW() - INTERVAL 30 DAY THEN 1 ELSE 0 END) AS d30_candidates,
      SUM(CASE WHEN last_visit_date > NOW() - INTERVAL 46 DAY AND last_visit_date <= NOW() - INTERVAL 45 DAY THEN 1 ELSE 0 END) AS d45_candidates,
      SUM(CASE WHEN last_visit_date > NOW() - INTERVAL 91 DAY AND last_visit_date <= NOW() - INTERVAL 90 DAY THEN 1 ELSE 0 END) AS d90_candidates,
      COUNT(*) AS total_customers_with_visit_date
    FROM customers
    WHERE phone IS NOT NULL AND phone != ''
      AND sms_opt_out = 0
  `);
  console.log("\nRetention candidates by tier (1-day window each):");
  console.log(JSON.stringify(retention, null, 2));

  // Stale leads · what staleLeadFollowup targets
  try {
    const [stale] = await conn.query(`
      SELECT COUNT(*) AS stale_lead_count
      FROM leads
      WHERE status IN ('new', 'contacted')
        AND created_at < NOW() - INTERVAL 3 DAY
        AND created_at > NOW() - INTERVAL 14 DAY
        AND phone IS NOT NULL
    `);
    console.log("\nStale lead candidates (3-14d old · new/contacted):");
    console.log(JSON.stringify(stale, null, 2));
  } catch (e) {
    console.log(`  (stale lead query failed: ${e instanceof Error ? e.message : String(e)})`);
  }
} finally {
  await conn.end();
}
