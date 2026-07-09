import mysql from "mysql2/promise";
import "dotenv/config";

const ID_CHILDREN: Array<[string, string]> = [
  ["invoices", "customerId"], ["tire_orders", "customerId"], ["portal_sessions", "customerId"],
  ["winback_sends", "customerId"], ["sms_campaign_sends", "customerId"],
  ["communication_log", "customer_id"], ["payments", "customer_id"],
];

async function main() {
  const uri = process.env.DATABASE_URL;
  if (!uri) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }
  console.log("Connecting to database...");
  const conn = await mysql.createConnection({ uri });

  try {
    const targets = [
      { name: "Jerome Alexander", loser: 90001, survivor: 1082 },
      { name: "Robert Borden", loser: 60017, survivor: 272 }
    ];

    for (const target of targets) {
      console.log(`\n==================================================`);
      console.log(`Checking target: ${target.name}`);
      console.log(`==================================================`);

      // 1. Fetch profiles
      const [profiles] = await conn.query(
        `SELECT id, firstName, lastName, phone, phone2, email, address, city, state, zip, vehicleYear, vehicleMake, vehicleModel
         FROM customers WHERE id IN (?, ?)`,
        [target.loser, target.survivor]
      ) as any;

      console.log("Profiles found in customers table:");
      console.log(JSON.stringify(profiles, null, 2));

      // 2. Fetch child counts
      console.log("\nChild record counts:");
      for (const [tbl, col] of ID_CHILDREN) {
        const [loserCount] = await conn.query(
          `SELECT COUNT(*) as count FROM ${tbl} WHERE ${col} = ?`,
          [target.loser]
        ) as any;
        const [survivorCount] = await conn.query(
          `SELECT COUNT(*) as count FROM ${tbl} WHERE ${col} = ?`,
          [target.survivor]
        ) as any;
        console.log(`  - Table ${tbl} (${col}): Loser ID ${target.loser} has ${loserCount[0].count}, Survivor ID ${target.survivor} has ${survivorCount[0].count}`);
      }

      // 3. Fetch customer_metrics count
      const [loserMetrics] = await conn.query(
        `SELECT COUNT(*) as count FROM customer_metrics WHERE customerId = ?`,
        [target.loser]
      ) as any;
      const [survivorMetrics] = await conn.query(
        `SELECT COUNT(*) as count FROM customer_metrics WHERE customerId = ?`,
        [target.survivor]
      ) as any;
      console.log(`  - Table customer_metrics: Loser ID ${target.loser} has ${loserMetrics[0].count}, Survivor ID ${target.survivor} has ${survivorMetrics[0].count}`);
    }

  } catch (error) {
    console.error("Error running dry run:", error);
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error("Crashed:", e);
  process.exit(1);
});
