/**
 * READ-ONLY follow-up investigation (customer-dedup-plan.md §2a-3 + edge cases).
 * Phone-based dedup found ZERO clusters (data is phone-clean), so the real
 * dupes are same-name+vehicle with DIFFERENT phones — quantify + sample those
 * for hand-review. Also surfaces the 4 non-10-digit rows + the orphan-invoice count.
 * Run: railway run -s MAINnicks-tire-auto pnpm exec tsx scripts/dedup-investigate.ts
 * All SELECT. Nothing writes.
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
    await q(
      "NAME DUPES (same first+last, phone10 differs) — count",
      `SELECT COUNT(*) AS name_dupe_clusters, COALESCE(SUM(c - 1),0) AS extra_rows
       FROM (
         SELECT UPPER(TRIM(firstName)) f, UPPER(TRIM(COALESCE(lastName,''))) l, COUNT(*) c
         FROM customers WHERE firstName IS NOT NULL
         GROUP BY f, l
         HAVING COUNT(*) > 1
            AND COUNT(DISTINCT RIGHT(REGEXP_REPLACE(phone,'[^0-9]',''),10)) > 1
       ) x`,
    );

    await q(
      "NAME DUPES — top 25 (eyeball: same person or coincidental name?)",
      `SELECT UPPER(TRIM(firstName)) f, UPPER(TRIM(COALESCE(lastName,''))) l,
              COUNT(*) AS dupes,
              GROUP_CONCAT(id ORDER BY id) AS ids,
              GROUP_CONCAT(DISTINCT phone SEPARATOR ' | ') AS phones,
              GROUP_CONCAT(DISTINCT CONCAT_WS(' ', firstName, lastName) SEPARATOR ' | ') AS name_variants,
              ROUND(SUM(totalSpent)/100) AS summed_spend_dollars,
              MAX(totalVisits) AS max_visits
       FROM customers WHERE firstName IS NOT NULL
       GROUP BY f, l
       HAVING dupes > 1
          AND COUNT(DISTINCT RIGHT(REGEXP_REPLACE(phone,'[^0-9]',''),10)) > 1
       ORDER BY dupes DESC, summed_spend_dollars DESC
       LIMIT 25`,
    );

    await q(
      "THE 4 NON-10-DIGIT PHONE ROWS",
      `SELECT id, phone, CONCAT_WS(' ', firstName, lastName) AS name, totalSpent, totalVisits
       FROM customers
       WHERE NOT (phone REGEXP '^[0-9]{10}$')
       LIMIT 20`,
    );

    // Would the normalized-phone UNIQUE key (item b) succeed today?
    await q(
      "PHONE10 UNIQUENESS CHECK (would UNIQUE(phone10) violate?)",
      `SELECT COUNT(*) AS phone10_collisions FROM (
         SELECT RIGHT(REGEXP_REPLACE(phone,'[^0-9]',''),10) p10, COUNT(*) c
         FROM customers WHERE CHAR_LENGTH(REGEXP_REPLACE(phone,'[^0-9]','')) >= 10
         GROUP BY p10 HAVING c > 1
       ) x`,
    );
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
