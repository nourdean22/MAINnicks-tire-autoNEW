/**
 * READ-ONLY customer-dedup sizing (customer-dedup-plan.md §2).
 * Measures the duplicate scope + phone-format chaos BEFORE any merge.
 * Run: railway run -s MAINnicks-tire-auto pnpm exec tsx scripts/dedup-sizing.ts
 * Every statement is a SELECT. Nothing here writes.
 */
import mysql from "mysql2/promise";

async function main() {
  const uri = process.env.DATABASE_URL;
  if (!uri) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }
  const conn = await mysql.createConnection({ uri });
  const q = async (label: string, sql: string) => {
    const [rows] = await conn.query(sql);
    console.log(`\n=== ${label} ===`);
    console.log(JSON.stringify(rows, null, 2));
  };
  try {
    await q("TOTAL CUSTOMERS", "SELECT COUNT(*) AS total FROM customers");

    await q(
      "DUPE CLUSTERS by normalized phone (>=10 digits)",
      `SELECT COUNT(*) AS dupe_clusters,
              SUM(rows_in_cluster) AS rows_in_dupe_clusters,
              SUM(rows_in_cluster - 1) AS rows_that_would_merge_away
       FROM (
         SELECT RIGHT(REGEXP_REPLACE(phone,'[^0-9]',''),10) AS phone10, COUNT(*) AS rows_in_cluster
         FROM customers
         WHERE phone IS NOT NULL AND CHAR_LENGTH(REGEXP_REPLACE(phone,'[^0-9]','')) >= 10
         GROUP BY phone10 HAVING COUNT(*) > 1
       ) c`,
    );

    await q(
      "PHONE FORMAT HISTOGRAM (how mixed the column is)",
      `SELECT CASE
         WHEN phone LIKE '+1%' THEN 'E.164 (+1...)'
         WHEN phone REGEXP '^[0-9]{10}$' THEN '10 digits'
         WHEN phone REGEXP '^1[0-9]{10}$' THEN '11 digits (1...)'
         WHEN phone REGEXP '[^0-9]' THEN 'has punctuation'
         ELSE 'other' END AS fmt,
       COUNT(*) AS n
       FROM customers GROUP BY fmt ORDER BY n DESC`,
    );

    await q(
      "TOP 15 DUPE GROUPS (worst offenders)",
      `SELECT RIGHT(REGEXP_REPLACE(phone,'[^0-9]',''),10) AS phone10,
              COUNT(*) AS dupes,
              GROUP_CONCAT(id ORDER BY id) AS ids,
              GROUP_CONCAT(DISTINCT phone ORDER BY phone SEPARATOR ' | ') AS phone_formats,
              GROUP_CONCAT(DISTINCT CONCAT_WS(' ', firstName, lastName) SEPARATOR ' | ') AS names,
              ROUND(SUM(totalSpent)/100) AS summed_spend_dollars,
              MAX(totalVisits) AS max_visits
       FROM customers
       WHERE phone IS NOT NULL AND CHAR_LENGTH(REGEXP_REPLACE(phone,'[^0-9]','')) >= 10
       GROUP BY phone10 HAVING dupes > 1
       ORDER BY dupes DESC, summed_spend_dollars DESC
       LIMIT 15`,
    );
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
