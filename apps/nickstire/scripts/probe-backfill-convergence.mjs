/**
 * READ-ONLY · ROS-093 step 4: has the widened backfill CONVERGED, and what is
 * left in the send list that it can never clear?
 *
 * #1592 widened the matcher to DECLINED_RECOVERY_WINDOW_DAYS (60) so it covers
 * the window declinedWorkRecovery actually texts on. Widening code does not move
 * rows — this measures whether the rows moved, and separates the two reasons a
 * row can still sit in the "declined" list:
 *
 *   (a) genuinely declined — no invoice exists. Correct to text.
 *   (b) UNMATCHABLE — sub-ten-digit phone the canon refuses to guess at. It can
 *       never match, so it stays "declined" forever and gets texted forever,
 *       regardless of whether the customer paid.
 *
 * (b) is the one worth knowing about: the backfill converging is not the same as
 * the list being correct.
 *
 * Structurally read-only: q() refuses anything that is not SELECT.
 */
import mysql from "mysql2/promise";
import fs from "fs";

const url = (fs.readFileSync(process.argv[2], "utf8").match(/^DATABASE_URL=(.*)$/m) || [])[1]?.trim();
if (!url) throw new Error("no DATABASE_URL");
const base = url.replace(/\?ssl=.*$/, "");
console.log("host:", new URL(base).hostname);

const conn = await mysql.createConnection(`${base}?ssl={"rejectUnauthorized":true}`);
const q = async (s) => {
  if (!/^\s*select/i.test(s)) throw new Error("REFUSED: " + s.slice(0, 40));
  const [r] = await conn.execute(s);
  return r;
};

console.log("\n=== estimate-sync runs, last 24h (does it report 'backfilled'?) ===");
console.table(
  await q(`
    SELECT started_at, job_name, LEFT(COALESCE(details,''),110) AS details
    FROM cron_log
    WHERE (job_name LIKE '%estimate%' OR job_name LIKE '%alg%')
      AND started_at >= NOW() - INTERVAL 1 DAY
    ORDER BY started_at DESC LIMIT 8
  `),
);

console.log("\n=== the eligible set, split by WHY it is still unmatched ===");
console.table(
  await q(`
    SELECT
      COUNT(*) AS eligible_60d,
      SUM(estimate_date < NOW() - INTERVAL 30 DAY) AS in_31_60d_band,
      SUM(customer_phone IS NULL
          OR LENGTH(REGEXP_REPLACE(COALESCE(customer_phone,''),'[^0-9]','')) < 10) AS unmatchable_phone
    FROM alg_estimates
    WHERE matched_invoice_id IS NULL AND estimate_date >= NOW() - INTERVAL 60 DAY
  `),
);

console.log("\n=== rows the matcher MISSED: an invoice exists on the same phone ===");
console.table(
  await q(`
    SELECT COUNT(DISTINCT e.id) AS eligible_but_invoice_exists
    FROM alg_estimates e
    JOIN invoices i
      ON REGEXP_REPLACE(COALESCE(i.customerPhone,''),'[^0-9]','') =
         REGEXP_REPLACE(COALESCE(e.customer_phone,''),'[^0-9]','')
     AND LENGTH(REGEXP_REPLACE(COALESCE(e.customer_phone,''),'[^0-9]','')) >= 10
    WHERE e.matched_invoice_id IS NULL
      AND e.estimate_date >= NOW() - INTERVAL 60 DAY
      AND i.invoiceDate >= e.estimate_date
  `),
);

await conn.end();
