import mysql from "mysql2/promise";
import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve(process.cwd(), ".env") });

async function main() {
  const uri = process.env.DATABASE_URL;
  if (!uri) { console.error("DATABASE_URL not set"); process.exit(1); }
  const conn = await mysql.createConnection({ uri });
  try {
    const ids = [1082, 90001, 272, 60017];
    const [custRows] = await conn.query("SELECT * FROM customers WHERE id IN (?)", [ids]);
    console.log("=== CUSTOMERS ===");
    console.log(JSON.stringify(custRows, null, 2));

    const [invRows] = await conn.query("SELECT * FROM invoices WHERE customerId IN (?)", [ids]);
    console.log("=== INVOICES ===");
    console.log(JSON.stringify(invRows, null, 2));
  } finally {
    await conn.end();
  }
}
main().catch(console.error);
