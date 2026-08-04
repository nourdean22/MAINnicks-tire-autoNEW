/**
 * probe-repeat-rate.mts · READ-ONLY (2026-08-03)
 *
 * "77% of customers never return" is the number every retention argument rests on.
 * This measures it FOUR ways, because the obvious query lies here:
 *
 *  - invoices.customerId is NULLABLE (schema.ts:1267) — an unmatched import has no
 *    customer link at all, so grouping by customerId silently drops those rows and
 *    inflates the one-and-done share.
 *  - Walk-ins with no phone cannot be attributed to a returning customer even when
 *    they did return: 136 of 175 phone-less invoices were previously found
 *    unrecoverable.
 *
 * So the honest output is not one number, it is a number PLUS how much of the
 * population could not be measured. If the unattributable share is large, "77%
 * churn" is partly a measurement artifact and the retention argument weakens.
 *
 * Pure SELECT. No writes, no spend.
 *   railway run --service MAINnicks-tire-auto -- pnpm exec tsx scripts/probe-repeat-rate.mts
 */
const { db } = await import("../server/lib/db-helper");
const d = await db();
if (!d) {
  console.log("database unavailable");
  process.exit(1);
}
const { sql } = await import("drizzle-orm");

const rows = async (q: ReturnType<typeof sql>) => {
  const r: any = await d.execute(q);
  return (Array.isArray(r) ? r[0] : r?.rows ?? r) as any[];
};

console.log("\n===== INVOICE POPULATION =====");
const pop = await rows(sql`
  SELECT COUNT(*) AS invoices,
         SUM(CASE WHEN customerId IS NULL THEN 1 ELSE 0 END) AS no_customer_link,
         SUM(CASE WHEN customerPhone IS NULL OR customerPhone = '' THEN 1 ELSE 0 END) AS no_phone,
         SUM(totalAmount)/100 AS gross_usd
  FROM invoices
`);
console.table(pop);

console.log("===== REPEAT RATE BY customerId (drops unlinked rows) =====");
const byId = await rows(sql`
  SELECT COUNT(*) AS linked_customers,
         SUM(CASE WHEN n = 1 THEN 1 ELSE 0 END) AS one_and_done,
         ROUND(100 * SUM(CASE WHEN n = 1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS pct_one_and_done
  FROM (SELECT customerId, COUNT(*) AS n FROM invoices WHERE customerId IS NOT NULL GROUP BY customerId) t
`);
console.table(byId);

console.log("===== REPEAT RATE BY NORMALISED PHONE (last 10 digits) =====");
const byPhone = await rows(sql`
  SELECT COUNT(*) AS phone_identities,
         SUM(CASE WHEN n = 1 THEN 1 ELSE 0 END) AS one_and_done,
         ROUND(100 * SUM(CASE WHEN n = 1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS pct_one_and_done
  FROM (
    SELECT RIGHT(REGEXP_REPLACE(customerPhone, '[^0-9]', ''), 10) AS ph, COUNT(*) AS n
    FROM invoices
    WHERE customerPhone IS NOT NULL AND customerPhone <> ''
      AND LENGTH(REGEXP_REPLACE(customerPhone, '[^0-9]', '')) >= 10
    GROUP BY ph
  ) t
`);
console.table(byPhone);

console.log("===== REPEAT RATE BY NORMALISED NAME (upper/trimmed) =====");
const byName = await rows(sql`
  SELECT COUNT(*) AS name_identities,
         SUM(CASE WHEN n = 1 THEN 1 ELSE 0 END) AS one_and_done,
         ROUND(100 * SUM(CASE WHEN n = 1 THEN 1 ELSE 0 END) / COUNT(*), 1) AS pct_one_and_done
  FROM (SELECT UPPER(TRIM(customerName)) AS nm, COUNT(*) AS n FROM invoices
        WHERE customerName IS NOT NULL AND TRIM(customerName) <> '' GROUP BY nm) t
`);
console.table(byName);

console.log("===== VALUE CONCENTRATION: what do repeat customers actually spend? =====");
const value = await rows(sql`
  SELECT CASE WHEN n = 1 THEN '1 visit' WHEN n = 2 THEN '2 visits'
              WHEN n BETWEEN 3 AND 5 THEN '3-5 visits' ELSE '6+ visits' END AS cohort,
         COUNT(*) AS customers,
         ROUND(SUM(spend)/100) AS total_usd,
         ROUND(AVG(spend)/100) AS avg_lifetime_usd
  FROM (
    SELECT RIGHT(REGEXP_REPLACE(customerPhone, '[^0-9]', ''), 10) AS ph,
           COUNT(*) AS n, SUM(totalAmount) AS spend
    FROM invoices
    WHERE customerPhone IS NOT NULL AND customerPhone <> ''
      AND LENGTH(REGEXP_REPLACE(customerPhone, '[^0-9]', '')) >= 10
    GROUP BY ph
  ) t
  GROUP BY cohort ORDER BY MIN(n)
`);
console.table(value);

console.log("");
process.exit(0);
