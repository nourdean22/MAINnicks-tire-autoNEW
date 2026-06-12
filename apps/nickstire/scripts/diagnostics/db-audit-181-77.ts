/**
 * wave-181.77 · deep DB audit · row counts + index usage + slow-query
 * indicators for the 5 new tables we added this session, plus a sample
 * EXPLAIN on the hot-path queries.
 *
 * Read-only · safe to run against prod. Operator can re-run anytime.
 */
import dotenv from "dotenv";
import { resolve } from "path";
import mysql from "mysql2/promise";

dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

const conn = await mysql.createConnection(process.env.DATABASE_URL!);
try {
  console.log("\n═══ Table row counts + index summary ═══\n");
  for (const t of [
    "otp_attempts",
    "sms_rate_limit",
    "cron_alerts_fired",
    "alg_estimates",
    "sms_messages",
    "sms_conversations",
    "drip_enrollments",
    "work_orders",
  ]) {
    try {
      const [r] = await conn.query(`SELECT COUNT(*) AS n FROM \`${t}\``);
      const [idx] = await conn.query(`SHOW INDEX FROM \`${t}\``);
      const idxNames = [...new Set((idx as Array<{ Key_name: string }>).map((i) => i.Key_name))];
      const count = ((r as Array<{ n: number }>)[0]?.n) ?? 0;
      console.log(`${t.padEnd(28)} · ${String(count).padStart(8)} rows · indexes: ${idxNames.join(", ")}`);
    } catch (e) {
      console.log(`${t.padEnd(28)} · [error: ${e instanceof Error ? e.message : String(e)}]`);
    }
  }

  console.log("\n═══ EXPLAIN: declinedWorkRecovery main query (hot path) ═══\n");
  const [exp1] = await conn.query(`
    EXPLAIN SELECT id, customer_name, customer_phone, service_description, estimated_amount, estimate_date, follow_up_7d_sent, follow_up_30d_sent
    FROM alg_estimates
    WHERE matched_invoice_id IS NULL
      AND estimate_date >= NOW() - INTERVAL 60 DAY
      AND estimate_date <= NOW() - INTERVAL 7 DAY
    LIMIT 100
  `);
  console.log(JSON.stringify(exp1, null, 2));

  console.log("\n═══ EXPLAIN: checkDailyLimit SELECT (every sendSms) ═══\n");
  const [exp2] = await conn.query(`
    EXPLAIN SELECT count_24h FROM sms_rate_limit WHERE phone = '+12168620005' LIMIT 1
  `);
  console.log(JSON.stringify(exp2, null, 2));

  console.log("\n═══ EXPLAIN: qc-comeback workOrders prior lookup ═══\n");
  const [exp3] = await conn.query(`
    EXPLAIN SELECT id, customer_id
    FROM work_orders
    WHERE customer_id IN (1, 2, 3, 4, 5)
      AND status IN ('closed', 'invoiced', 'picked_up')
      AND created_at >= NOW() - INTERVAL 30 DAY
  `);
  console.log(JSON.stringify(exp3, null, 2));

  console.log("\n═══ EXPLAIN: cleanup cron prune query (otp_attempts) ═══\n");
  const [exp4] = await conn.query(`
    EXPLAIN DELETE FROM otp_attempts
    WHERE updated_at < (NOW() - INTERVAL 2 HOUR)
      AND (blocked_until IS NULL OR blocked_until < NOW())
  `);
  console.log(JSON.stringify(exp4, null, 2));

  console.log("\n═══ Detect leading-wildcard LIKE patterns (silent full scans) ═══\n");
  // Look at process list + recent slow query log if accessible
  try {
    const [pl] = await conn.query(`SHOW FULL PROCESSLIST`);
    const list = pl as Array<{ Info: string | null; Time: number; State: string | null }>;
    const slow = list.filter((p) => p.Info && p.Time > 1 && p.Info.includes("LIKE '%"));
    console.log(slow.length > 0 ? JSON.stringify(slow, null, 2) : "  (no leading-wildcard LIKEs in-flight)");
  } catch (e) {
    console.log(`  (PROCESSLIST unavailable: ${e instanceof Error ? e.message : String(e)})`);
  }

  console.log("\n═══ sms_messages auto-increment health ═══\n");
  try {
    const [ai] = await conn.query(`
      SELECT TABLE_NAME, AUTO_INCREMENT, DATA_LENGTH, INDEX_LENGTH
      FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'sms_messages'
    `);
    console.log(JSON.stringify(ai, null, 2));
  } catch (e) {
    console.log(`  (info_schema unavailable: ${e instanceof Error ? e.message : String(e)})`);
  }
} finally {
  await conn.end();
}
