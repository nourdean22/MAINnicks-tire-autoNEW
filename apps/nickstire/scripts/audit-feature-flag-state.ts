import dotenv from "dotenv";
import { resolve } from "path";
import mysql from "mysql2/promise";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

const conn = await mysql.createConnection(process.env.DATABASE_URL!);
try {
  console.log("\n═══ feature_flags state ═══\n");
  const [show] = await conn.query("SHOW TABLES LIKE 'feature_flags'");
  if ((show as unknown[]).length === 0) {
    // try alternative naming
    const [show2] = await conn.query("SHOW TABLES LIKE 'featureFlags'");
    console.log("Tables matching 'feature%':");
    const [t] = await conn.query("SHOW TABLES LIKE '%feature%'");
    console.log(JSON.stringify(t, null, 2));
    console.log(JSON.stringify(show2, null, 2));
  } else {
    const [r] = await conn.query("SELECT * FROM feature_flags ORDER BY `key`");
    console.log(JSON.stringify(r, null, 2));
  }
} finally {
  await conn.end();
}
