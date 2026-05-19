import dotenv from "dotenv";
import { resolve } from "path";
import mysql from "mysql2/promise";

dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

const conn = await mysql.createConnection(process.env.DATABASE_URL!);
try {
  const [c] = await conn.query("SHOW COLUMNS FROM work_orders");
  const cols = c as Array<{ Field: string; Type: string; Null: string; Key: string }>;
  const target = cols.filter((r) => ["customer_id", "status", "created_at", "id"].includes(r.Field));
  console.log("work_orders critical columns:");
  console.log(JSON.stringify(target, null, 2));

  console.log("\nwork_orders index list:");
  const [idx] = await conn.query("SHOW INDEX FROM work_orders");
  const cleaned = (idx as Array<{ Key_name: string; Column_name: string; Seq_in_index: number }>)
    .reduce<Record<string, string[]>>((acc, r) => {
      const k = r.Key_name;
      if (!acc[k]) acc[k] = [];
      acc[k][r.Seq_in_index - 1] = r.Column_name;
      return acc;
    }, {});
  console.log(JSON.stringify(cleaned, null, 2));

  // Test the actual ACT N+1 query as-issued by drizzle with numeric ID
  console.log("\nEXPLAIN with INT customer_id (would be expected type):");
  const [exp1] = await conn.query(`
    EXPLAIN SELECT id, customer_id
    FROM work_orders
    WHERE customer_id IN (1, 2, 3)
      AND status IN ('closed', 'invoiced', 'picked_up')
      AND created_at >= NOW() - INTERVAL 30 DAY
  `);
  console.log(JSON.stringify(exp1, null, 2));

  console.log("\nEXPLAIN with STRING customer_id (drizzle's inArray with string[]):");
  const [exp2] = await conn.query(`
    EXPLAIN SELECT id, customer_id
    FROM work_orders
    WHERE customer_id IN ('1', '2', '3')
      AND status IN ('closed', 'invoiced', 'picked_up')
      AND created_at >= NOW() - INTERVAL 30 DAY
  `);
  console.log(JSON.stringify(exp2, null, 2));
} finally {
  await conn.end();
}
