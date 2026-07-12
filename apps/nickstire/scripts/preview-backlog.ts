import dotenv from "dotenv";
import { resolve } from "path";
import mysql from "mysql2/promise";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

async function main(): Promise<void> {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  try {
    const [colRows] = await conn.query("SHOW COLUMNS FROM alg_estimates");
    const cols = (colRows as Array<{ Field: string }>).map((r) => r.Field);
    const amountCol = cols.find((c) => /amount|value|price|cents|total/i.test(c)) || "<none>";
    console.log(`alg_estimates amount-like columns: ${cols.filter((c) => /amount|value|price|cents|total/i.test(c)).join(", ") || "<none>"}`);

    const [totals] = await conn.query(`
      SELECT
        COUNT(*) AS total_estimates,
        ROUND(SUM(${amountCol}) / 100, 2) AS total_value_dollars,
        SUM(CASE WHEN follow_up_7d_sent = 0 AND follow_up_7d_attempted_at IS NULL THEN 1 ELSE 0 END) AS eligible_7d,
        SUM(CASE WHEN follow_up_30d_sent = 0 AND follow_up_30d_attempted_at IS NULL THEN 1 ELSE 0 END) AS eligible_30d,
        SUM(CASE WHEN follow_up_7d_sent = 1 OR follow_up_30d_sent = 1 THEN 1 ELSE 0 END) AS already_sent,
        SUM(CASE WHEN matched_invoice_id IS NOT NULL THEN 1 ELSE 0 END) AS converted_to_invoice
      FROM alg_estimates
      WHERE customer_phone IS NOT NULL AND customer_phone != ''
    `);
    const [otpStats] = await conn.query("SELECT COUNT(*) AS active_otp_rows FROM otp_attempts");
    const [smsColRows] = await conn.query("SHOW COLUMNS FROM sms_messages");
    const smsCols = (smsColRows as Array<{ Field: string }>).map((r) => r.Field);
    const tsCol = smsCols.find((c) => /createdAt|created_at|sent_at|sentAt|created/i.test(c));
    const smsStatus = tsCol
      ? (await conn.query(`SELECT status, COUNT(*) AS n FROM sms_messages WHERE \`${tsCol}\` > NOW() - INTERVAL 7 DAY GROUP BY status ORDER BY n DESC`))[0]
      : [];

    console.log("\n═══ Backlog preview ═══\n");
    console.log("alg_estimates (declined-work backlog):");
    console.log(JSON.stringify((totals as unknown[])[0], null, 2));
    console.log("\notp_attempts (durable brute-force counter):");
    console.log(JSON.stringify((otpStats as unknown[])[0], null, 2));
    console.log("\nsms_messages by status (last 7d):");
    console.log(JSON.stringify(smsStatus, null, 2));
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
