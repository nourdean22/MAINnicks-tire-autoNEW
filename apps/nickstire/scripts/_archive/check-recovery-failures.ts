import dotenv from "dotenv";
import { resolve } from "path";
import mysql from "mysql2/promise";

dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

const conn = await mysql.createConnection(process.env.DATABASE_URL!);
try {
  // Sample 5 most recent failed sends to see what's in their body / variantKey / phone shape
  const [rows] = await conn.query(`
    SELECT id, \`createdAt\`, status, variantKey, twilioSid, LEFT(body, 80) AS body_preview
    FROM sms_messages
    WHERE \`createdAt\` > NOW() - INTERVAL 15 MINUTE AND status = 'failed'
    ORDER BY \`createdAt\` DESC
    LIMIT 10
  `);
  console.log("Recent failed sends:");
  console.log(JSON.stringify(rows, null, 2));

  // Check phone format in alg_estimates — is the phone field set?
  const [phones] = await conn.query(`
    SELECT id, customer_phone, customer_name, follow_up_7d_attempted_at
    FROM alg_estimates
    WHERE follow_up_7d_attempted_at > NOW() - INTERVAL 15 MINUTE
    LIMIT 5
  `);
  console.log("\nSample claimed estimates:");
  console.log(JSON.stringify(phones, null, 2));
} finally {
  await conn.end();
}
