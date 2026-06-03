/**
 * DEDUP STEP 2 — the transactional merge. DESTRUCTIVE (deletes loser rows).
 * Requires step 1's _bak_*_dedup_<STAMP> backups to exist (rollback net).
 * Per-pair in a single transaction: COALESCE-up profile onto survivor (+ retain
 * loser's phone as phone2), repoint the 8 int-FK children (plan §4a/§5C),
 * delete loser metrics + loser, normalize survivor phone, verify 0 phone10
 * dupes, COMMIT (auto-ROLLBACK on any error or failed verify).
 * Aggregates (spend/visits) self-heal via customers.enrich + refreshMetrics after.
 * Run: railway run -s MAINnicks-tire-auto pnpm exec tsx scripts/dedup-merge-2-execute.ts
 */
import mysql from "mysql2/promise";

const STAMP = "20260603";
const ID_CHILDREN: Array<[string, string]> = [
  ["invoices", "customerId"], ["tire_orders", "customerId"], ["portal_sessions", "customerId"],
  ["winback_sends", "customerId"], ["sms_campaign_sends", "customerId"],
  ["communication_log", "customer_id"], ["payments", "customer_id"],
];
const MAP_SELECT = `
  SELECT c.id AS loser_id, k.keep_id AS keep_id
  FROM customers c
  JOIN (
    SELECT UPPER(TRIM(firstName)) f, UPPER(TRIM(COALESCE(lastName,''))) l, MIN(id) AS keep_id
    FROM customers WHERE firstName IS NOT NULL
    GROUP BY f, l
    HAVING COUNT(*) > 1
       AND COUNT(DISTINCT RIGHT(REGEXP_REPLACE(phone,'[^0-9]',''),10)) > 1
       AND COUNT(DISTINCT NULLIF(CONCAT_WS('|',UPPER(TRIM(COALESCE(vehicleMake,''))),UPPER(TRIM(COALESCE(vehicleModel,''))),TRIM(COALESCE(vehicleYear,''))),'||')) <= 1
  ) k ON UPPER(TRIM(c.firstName)) = k.f AND UPPER(TRIM(COALESCE(c.lastName,''))) = k.l
  WHERE c.id <> k.keep_id`;

async function main() {
  const uri = process.env.DATABASE_URL;
  if (!uri) { console.error("DATABASE_URL not set"); process.exit(1); }
  const conn = await mysql.createConnection({ uri });
  try {
    // Guard: backup must exist.
    let bakCount = 0;
    try { const [b] = (await conn.query(`SELECT COUNT(*) AS c FROM _bak_cust_dedup_${STAMP}`)) as any; bakCount = b[0].c; }
    catch { console.error(`BACKUP _bak_cust_dedup_${STAMP} MISSING — run step 1 first.`); process.exit(1); }
    if (bakCount === 0) { console.error("BACKUP empty — run step 1 first."); process.exit(1); }

    const [mapRows] = (await conn.query(MAP_SELECT)) as any;
    const rows = mapRows as Array<{ loser_id: number; keep_id: number }>;
    if (rows.length === 0) { console.log("Nothing to merge."); return; }
    const loserIds = rows.map((r) => r.loser_id);
    const survivorIds = [...new Set(rows.map((r) => r.keep_id))];

    const [losers] = (await conn.query(
      `SELECT id, phone, email, address, city, state, zip, vehicleYear, vehicleMake, vehicleModel,
              alsCustomerId, notes, firstVisitDate, lastVisitDate, smsOptOut, smsCampaignSent
       FROM customers WHERE id IN (?)`, [loserIds],
    )) as any;
    const byId = new Map((losers as any[]).map((l) => [l.id, l]));

    const [before] = (await conn.query("SELECT COUNT(*) AS c FROM customers")) as any;
    await conn.beginTransaction();
    try {
      for (const { loser_id, keep_id } of rows) {
        const L = byId.get(loser_id);
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
          [L.phone, L.email, L.address, L.city, L.state, L.zip, L.vehicleYear, L.vehicleMake, L.vehicleModel,
           L.alsCustomerId, L.notes, L.firstVisitDate, L.firstVisitDate, L.lastVisitDate, L.lastVisitDate,
           L.smsOptOut, L.smsCampaignSent, keep_id],
        );
        for (const [tbl, col] of ID_CHILDREN) {
          await conn.query(`UPDATE ${tbl} SET ${col} = ? WHERE ${col} = ?`, [keep_id, loser_id]);
        }
        await conn.query("DELETE FROM customer_metrics WHERE customerId = ?", [loser_id]);
        await conn.query("DELETE FROM customers WHERE id = ?", [loser_id]);
      }
      // Normalize survivor phones to canonical 10-digit (plan §5E).
      await conn.query(
        `UPDATE customers SET phone = RIGHT(REGEXP_REPLACE(phone,'[^0-9]',''),10)
         WHERE id IN (?) AND CHAR_LENGTH(REGEXP_REPLACE(phone,'[^0-9]','')) >= 10
           AND phone <> RIGHT(REGEXP_REPLACE(phone,'[^0-9]',''),10)`, [survivorIds],
      );
      const [dupes] = (await conn.query(
        `SELECT RIGHT(REGEXP_REPLACE(phone,'[^0-9]',''),10) AS p10, COUNT(*) c
         FROM customers WHERE CHAR_LENGTH(REGEXP_REPLACE(phone,'[^0-9]','')) >= 10
         GROUP BY p10 HAVING c > 1`)) as any;
      if ((dupes as any[]).length > 0) {
        await conn.rollback();
        console.error("VERIFY FAILED — phone10 dupes remain. ROLLED BACK:", JSON.stringify(dupes));
        process.exit(1);
      }
      await conn.commit();
      const [after] = (await conn.query("SELECT COUNT(*) AS c FROM customers")) as any;
      console.log(`MERGE COMMITTED. Deleted ${rows.length} duplicate rows. Customers: ${before[0].c} -> ${after[0].c}.`);
      console.log("Next: recompute spend/visits (customers.enrich + refreshMetrics) so the survivors' aggregates are authoritative.");
    } catch (e) {
      await conn.rollback();
      console.error("MERGE ERROR — ROLLED BACK:", e);
      process.exit(1);
    }
  } finally {
    await conn.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
