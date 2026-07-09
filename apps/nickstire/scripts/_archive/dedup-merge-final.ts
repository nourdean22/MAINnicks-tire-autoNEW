import mysql from "mysql2/promise";
import "dotenv/config";

const ID_CHILDREN: Array<[string, string]> = [
  ["invoices", "customerId"], ["tire_orders", "customerId"], ["portal_sessions", "customerId"],
  ["winback_sends", "customerId"], ["sms_campaign_sends", "customerId"],
  ["communication_log", "customer_id"], ["payments", "customer_id"],
];

const TARGETS = [
  { name: "Jerome Alexander", loser: 90001, survivor: 1082 },
  { name: "Robert Borden", loser: 60017, survivor: 272 }
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
    const [beforeCount] = (await conn.query("SELECT COUNT(*) AS c FROM customers")) as any;
    console.log(`Initial customer count: ${beforeCount[0].c}`);

    console.log("Beginning transaction...");
    await conn.beginTransaction();

    try {
      for (const target of TARGETS) {
        console.log(`\nMerging ${target.name} (Loser: ${target.loser} -> Survivor: ${target.survivor})...`);

        // Fetch loser details
        const [loserRows] = await conn.query(
          `SELECT id, phone, email, address, city, state, zip, vehicleYear, vehicleMake, vehicleModel,
                  alsCustomerId, notes, firstVisitDate, lastVisitDate, smsOptOut, smsCampaignSent
           FROM customers WHERE id = ?`,
          [target.loser]
        ) as any;

        if (loserRows.length === 0) {
          throw new Error(`Loser ID ${target.loser} not found!`);
        }
        const L = loserRows[0];

        // Update survivor profile by coalescing fields
        console.log("  Updating survivor profile...");
        await conn.query(
          `UPDATE customers SET
             phone2 = COALESCE(phone2, ?), email = COALESCE(email, ?), address = COALESCE(address, ?),
             city = COALESCE(city, ?), state = COALESCE(state, ?), zip = COALESCE(zip, ?),
             vehicleYear = COALESCE(vehicleYear, ?), vehicleMake = COALESCE(vehicleMake, ?), vehicleModel = COALESCE(vehicleModel, ?),
             alsCustomerId = COALESCE(alsCustomerId, ?), notes = COALESCE(notes, ?),
             firstVisitDate = LEAST(COALESCE(firstVisitDate, ?), COALESCE(?, firstVisitDate)),
             lastVisitDate = GREATEST(COALESCE(lastVisitDate, ?), COALESCE(?, lastVisitDate)),
             smsOptOut = GREATEST(smsOptOut, ?), smsCampaignSent = GREATEST(smsCampaignSent, ?)
           WHERE id = ?`,
          [
            L.phone, L.email, L.address, L.city, L.state, L.zip, L.vehicleYear, L.vehicleMake, L.vehicleModel,
            L.alsCustomerId, L.notes, L.firstVisitDate, L.firstVisitDate, L.lastVisitDate, L.lastVisitDate,
            L.smsOptOut || 0, L.smsCampaignSent || 0, target.survivor
          ]
        );

        // Repoint child records
        for (const [tbl, col] of ID_CHILDREN) {
          console.log(`  Repointing ${tbl}.${col} from ${target.loser} to ${target.survivor}...`);
          const [result] = await conn.query(
            `UPDATE ${tbl} SET ${col} = ? WHERE ${col} = ?`,
            [target.survivor, target.loser]
          ) as any;
          console.log(`    Affected rows in ${tbl}: ${result.affectedRows}`);
        }

        // Delete loser metrics
        console.log(`  Deleting metrics for loser ID ${target.loser}...`);
        await conn.query("DELETE FROM customer_metrics WHERE customerId = ?", [target.loser]);

        // Delete loser customer row
        console.log(`  Deleting customer row for loser ID ${target.loser}...`);
        await conn.query("DELETE FROM customers WHERE id = ?", [target.loser]);
      }

      // Normalize survivor phones to canonical 10-digit
      console.log("\nNormalizing survivor phone numbers to 10-digit...");
      const survivorIds = TARGETS.map(t => t.survivor);
      await conn.query(
        `UPDATE customers SET phone = RIGHT(REGEXP_REPLACE(phone,'[^0-9]',''),10)
         WHERE id IN (?) AND CHAR_LENGTH(REGEXP_REPLACE(phone,'[^0-9]','')) >= 10
           AND phone <> RIGHT(REGEXP_REPLACE(phone,'[^0-9]',''),10)`,
        [survivorIds]
      );

      // Verify that no duplicate phone10 rows remain for the survivors or in general
      const [dupes] = await conn.query(
        `SELECT RIGHT(REGEXP_REPLACE(phone,'[^0-9]',''),10) AS p10, COUNT(*) c
         FROM customers WHERE CHAR_LENGTH(REGEXP_REPLACE(phone,'[^0-9]','')) >= 10
         GROUP BY p10 HAVING c > 1`
      ) as any;

      if (dupes.length > 0) {
        throw new Error(`VERIFY FAILED: phone10 duplicates remain. Dupes: ${JSON.stringify(dupes)}`);
      }

      console.log("Verification checks passed. Committing transaction...");
      await conn.commit();

      const [afterCount] = (await conn.query("SELECT COUNT(*) AS c FROM customers")) as any;
      console.log(`Transaction committed successfully! Customers: ${beforeCount[0].c} -> ${afterCount[0].c}.`);

    } catch (txError) {
      console.error("Error during transaction, rolling back...", txError);
      await conn.rollback();
      throw txError;
    }

    // Now trigger customer data enrichment and metrics refresh
    console.log("\nRunning enrichCustomerData() (canonical, same as admin Sync Data)...");
    const { enrichCustomerData } = await import("../server/services/dataPipelines");
    const enrichResult = await enrichCustomerData();
    console.log("Enrich result:", JSON.stringify(enrichResult));

    console.log("\nRunning refreshCustomerMetrics() (canonical, same as admin Recompute)...");
    const { refreshCustomerMetrics } = await import("../server/services/customerMetricsRefresh");
    const metricsResult = await refreshCustomerMetrics();
    console.log("Metrics result:", JSON.stringify(metricsResult));

    console.log("\nRecompute and merge complete!");

  } catch (error) {
    console.error("Fatal merge error:", error);
    process.exit(1);
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error("Crashed:", e);
  process.exit(1);
});
