import dotenv from "dotenv";
import { resolve } from "path";
import mysql from "mysql2/promise";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

const conn = await mysql.createConnection(process.env.DATABASE_URL!);
try {
  // All flags whose key contains 'sms' or 'retention' or 'cross' or 'winback' or 'smart' or 'lead'
  const [r] = await conn.query(`
    SELECT \`key\`, value, description
    FROM feature_flags
    WHERE \`key\` LIKE '%sms%'
       OR \`key\` LIKE '%retention%'
       OR \`key\` LIKE '%cross%'
       OR \`key\` LIKE '%winback%'
       OR \`key\` LIKE '%smart%'
       OR \`key\` LIKE '%lead%'
       OR \`key\` LIKE '%recovery%'
       OR \`key\` LIKE '%followup%'
    ORDER BY \`key\`
  `);
  console.log("Revenue-cron feature flag state:");
  console.log(JSON.stringify(r, null, 2));

  // What env vars are missing? Check the obvious ones
  console.log("\nKey env vars (set vs missing):");
  for (const v of ["FEATURE_DECLINED_RECOVERY", "SMS_KILL_SWITCH", "TWILIO_ACCOUNT_SID", "SHOP_SMS_GATEWAY_USERNAME"]) {
    console.log(`  ${v}: ${process.env[v] ? "<set>" : "<unset>"}`);
  }
} finally {
  await conn.end();
}
