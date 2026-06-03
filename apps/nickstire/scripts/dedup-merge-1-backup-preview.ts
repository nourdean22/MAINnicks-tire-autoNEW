/**
 * DEDUP STEP 1 — backup + dry-run preview. NON-DESTRUCTIVE.
 * TiDB has no CTAS, so: keeper-map via plain SELECT (JS), backups via
 * CREATE TABLE LIKE + INSERT...SELECT.
 * Match key = same first+last + CONSISTENT vehicle (no conflicting non-null
 * vehicle) + phone10 differs. Excludes same-name/different-car.
 * Run: railway run -s MAINnicks-tire-auto pnpm exec tsx scripts/dedup-merge-1-backup-preview.ts
 */
import mysql from "mysql2/promise";

const STAMP = "20260603";
const CHILDREN: Array<[string, string]> = [
  ["invoices", "customerId"], ["tire_orders", "customerId"], ["portal_sessions", "customerId"],
  ["winback_sends", "customerId"], ["sms_campaign_sends", "customerId"],
  ["communication_log", "customer_id"], ["payments", "customer_id"], ["customer_metrics", "customerId"],
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
    const [mapRows] = (await conn.query(MAP_SELECT)) as any;
    const rows = mapRows as Array<{ loser_id: number; keep_id: number }>;
    const survivors = new Set(rows.map((r) => r.keep_id)).size;
    console.log(`\n=== MERGE MAP: ${rows.length} losers -> ${survivors} survivors ===`);
    if (rows.length === 0) { console.log("Nothing to merge."); return; }

    const loserIds = rows.map((r) => r.loser_id);
    const allIds = [...new Set([...loserIds, ...rows.map((r) => r.keep_id)])];

    const [pairs] = (await conn.query(
      `SELECT m.loser_id, m.keep_id, CONCAT_WS(' ', kc.firstName, kc.lastName) AS name,
              NULLIF(CONCAT_WS('-', kc.vehicleYear, kc.vehicleMake, kc.vehicleModel),'--') AS keeper_vehicle,
              NULLIF(CONCAT_WS('-', lc.vehicleYear, lc.vehicleMake, lc.vehicleModel),'--') AS loser_vehicle,
              kc.phone AS keeper_phone, lc.phone AS loser_phone,
              ROUND(kc.totalSpent/100) AS keeper_spend, ROUND(lc.totalSpent/100) AS loser_spend
       FROM (${MAP_SELECT}) m
       JOIN customers kc ON kc.id = m.keep_id
       JOIN customers lc ON lc.id = m.loser_id
       ORDER BY m.keep_id`,
    )) as any;
    console.log("\n=== MERGE PAIRS (verify: vehicles match or null = same person) ===");
    console.log(JSON.stringify(pairs, null, 2));

    // BACKUP — CREATE LIKE + INSERT...SELECT (TiDB-compatible; additive)
    await conn.query(`DROP TABLE IF EXISTS _bak_cust_dedup_${STAMP}`);
    await conn.query(`CREATE TABLE _bak_cust_dedup_${STAMP} LIKE customers`);
    await conn.query(`INSERT INTO _bak_cust_dedup_${STAMP} SELECT * FROM customers WHERE id IN (?)`, [allIds]);
    for (const [tbl, col] of CHILDREN) {
      await conn.query(`DROP TABLE IF EXISTS _bak_${tbl}_dedup_${STAMP}`);
      await conn.query(`CREATE TABLE _bak_${tbl}_dedup_${STAMP} (child_id BIGINT, old_customer_id INT)`);
      await conn.query(
        `INSERT INTO _bak_${tbl}_dedup_${STAMP} (child_id, old_customer_id) SELECT id, ${col} FROM ${tbl} WHERE ${col} IN (?)`,
        [loserIds],
      );
    }
    const [cnt] = (await conn.query(`SELECT COUNT(*) AS c FROM _bak_cust_dedup_${STAMP}`)) as any;
    console.log(`\n=== BACKUPS CREATED — _bak_*_dedup_${STAMP} (rollback net); customers backed up: ${(cnt as any)[0].c} ===`);
    console.log(">>> STEP 1 DONE (no live rows changed). Review the pairs, then run step 2 (merge).");
  } finally {
    await conn.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
