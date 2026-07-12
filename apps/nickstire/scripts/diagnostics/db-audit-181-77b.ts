/**
 * wave-181.77 deep-dive part 2 · column types + drip_enrollments schema +
 * sms_messages indexes (since it's the busiest table at 510k rows).
 */
import dotenv from "dotenv";
import { resolve } from "path";
import mysql from "mysql2/promise";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

const conn = await mysql.createConnection(process.env.DATABASE_URL!);
try {
  console.log("\n═══ work_orders.customer_id column type (qc-comeback CAST suspect) ═══\n");
  const [c1] = await conn.query(
    "SHOW COLUMNS FROM work_orders LIKE 'customer_id'",
  );
  console.log(JSON.stringify(c1, null, 2));

  console.log("\n═══ work_orders index summary ═══\n");
  const [idx1] = await conn.query("SHOW INDEX FROM work_orders");
  const cleaned1 = (idx1 as Array<{ Key_name: string; Column_name: string; Seq_in_index: number }>)
    .reduce<Record<string, string[]>>((acc, r) => {
      const k = r.Key_name;
      if (!acc[k]) acc[k] = [];
      acc[k][r.Seq_in_index - 1] = r.Column_name;
      return acc;
    }, {});
  console.log(JSON.stringify(cleaned1, null, 2));

  console.log("\n═══ drip_enrollments schema + indexes (wave-181.67 FOR UPDATE target) ═══\n");
  try {
    const [d1] = await conn.query("SHOW COLUMNS FROM drip_enrollments");
    console.log("columns:");
    console.log(JSON.stringify(d1, null, 2));
    const [d2] = await conn.query("SHOW INDEX FROM drip_enrollments");
    const cleaned2 = (d2 as Array<{ Key_name: string; Column_name: string; Seq_in_index: number }>)
      .reduce<Record<string, string[]>>((acc, r) => {
        const k = r.Key_name;
        if (!acc[k]) acc[k] = [];
        acc[k][r.Seq_in_index - 1] = r.Column_name;
        return acc;
      }, {});
    console.log("\nindexes:");
    console.log(JSON.stringify(cleaned2, null, 2));
  } catch (e) {
    console.log(`  (table not present: ${e instanceof Error ? e.message : String(e)})`);
  }

  console.log("\n═══ sms_messages index summary (510k rows · hot table) ═══\n");
  const [idx3] = await conn.query("SHOW INDEX FROM sms_messages");
  const cleaned3 = (idx3 as Array<{ Key_name: string; Column_name: string; Seq_in_index: number }>)
    .reduce<Record<string, string[]>>((acc, r) => {
      const k = r.Key_name;
      if (!acc[k]) acc[k] = [];
      acc[k][r.Seq_in_index - 1] = r.Column_name;
      return acc;
    }, {});
  console.log(JSON.stringify(cleaned3, null, 2));

  console.log("\n═══ EXPLAIN: drip_enrollments dedup query (wave-181.67 FOR UPDATE) ═══\n");
  try {
    const [exp1] = await conn.query(`
      EXPLAIN SELECT id FROM drip_enrollments
      WHERE customerPhone = '+12168620005' AND campaignId = 'at-risk' AND status = 'active'
      LIMIT 1
    `);
    console.log(JSON.stringify(exp1, null, 2));
  } catch (e) {
    console.log(`  (skipped: ${e instanceof Error ? e.message : String(e)})`);
  }

  console.log("\n═══ EXPLAIN: cleanup cron's sms_rate_limit prune ═══\n");
  const [exp2] = await conn.query(`
    EXPLAIN DELETE FROM sms_rate_limit WHERE updated_at < (NOW() - INTERVAL 25 HOUR)
  `);
  console.log(JSON.stringify(exp2, null, 2));

  console.log("\n═══ EXPLAIN: sms_messages recent-by-conversation (admin chat thread) ═══\n");
  const [exp3] = await conn.query(`
    EXPLAIN SELECT id, body, direction, status, createdAt
    FROM sms_messages
    WHERE conversationId = 1
    ORDER BY createdAt DESC
    LIMIT 200
  `);
  console.log(JSON.stringify(exp3, null, 2));
} finally {
  await conn.end();
}
