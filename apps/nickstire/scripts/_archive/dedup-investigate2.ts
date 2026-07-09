/**
 * READ-ONLY dedup characterization v2 — categorize name-dupes by corroboration
 * so the merge is HIGH-CONFIDENCE only (no merging two distinct same-name people).
 * Run: railway run -s MAINnicks-tire-auto pnpm exec tsx scripts/dedup-investigate2.ts
 * All SELECT. Nothing writes.
 */
import mysql from "mysql2/promise";

async function main() {
  const uri = process.env.DATABASE_URL;
  if (!uri) { console.error("DATABASE_URL not set"); process.exit(1); }
  const conn = await mysql.createConnection({ uri });
  const q = async (label: string, sql: string) => {
    const [rows] = await conn.query(sql);
    console.log(`\n=== ${label} ===`);
    console.log(JSON.stringify(rows, null, 2));
  };
  try {
    await q(
      "TOTAL name-dupe clusters (same first+last, phone10 differs)",
      `SELECT COUNT(*) AS clusters, COALESCE(SUM(c-1),0) AS extra_rows FROM (
         SELECT UPPER(TRIM(firstName)) f, UPPER(TRIM(COALESCE(lastName,''))) l, COUNT(*) c
         FROM customers WHERE firstName IS NOT NULL
         GROUP BY f,l HAVING COUNT(*)>1 AND COUNT(DISTINCT RIGHT(REGEXP_REPLACE(phone,'[^0-9]',''),10))>1
       ) x`,
    );
    await q(
      "DEFINITIVE dupes — same alsCustomerId (shop-system ID; guaranteed same person)",
      `SELECT alsCustomerId, COUNT(*) AS rows_, GROUP_CONCAT(id ORDER BY id) ids,
              GROUP_CONCAT(DISTINCT CONCAT_WS(' ',firstName,lastName) SEPARATOR ' | ') names
       FROM customers WHERE alsCustomerId IS NOT NULL AND alsCustomerId <> ''
       GROUP BY alsCustomerId HAVING COUNT(*)>1 ORDER BY rows_ DESC LIMIT 40`,
    );
    await q(
      "NAME-DUPE CLUSTERS w/ corroboration detail (top 40 by spend) — categorize each",
      `SELECT UPPER(TRIM(firstName)) f, UPPER(TRIM(COALESCE(lastName,''))) l,
              COUNT(*) dupes,
              GROUP_CONCAT(id ORDER BY id) ids,
              GROUP_CONCAT(DISTINCT COALESCE(alsCustomerId,'-') SEPARATOR ' | ') als_ids,
              GROUP_CONCAT(DISTINCT NULLIF(CONCAT_WS('-',vehicleYear,vehicleMake,vehicleModel),'') SEPARATOR ' | ') vehicles,
              GROUP_CONCAT(DISTINCT NULLIF(email,'') SEPARATOR ' | ') emails,
              GROUP_CONCAT(DISTINCT NULLIF(zip,'') SEPARATOR ' | ') zips,
              GROUP_CONCAT(DISTINCT phone SEPARATOR ' | ') phones,
              ROUND(SUM(totalSpent)/100) spend, MAX(totalVisits) max_visits
       FROM customers WHERE firstName IS NOT NULL
       GROUP BY f,l HAVING dupes>1 AND COUNT(DISTINCT RIGHT(REGEXP_REPLACE(phone,'[^0-9]',''),10))>1
       ORDER BY spend DESC, dupes DESC LIMIT 40`,
    );
  } finally { await conn.end(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
