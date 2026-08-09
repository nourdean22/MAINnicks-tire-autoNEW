/**
 * page-traffic-readonly.mts — READ-ONLY per-page traffic pull from search_performance.
 *
 * Operator-authorized 2026-08-09 to unblock public-page KEEP / 301 / 410 decisions.
 *
 * SAFETY — this file contains SELECT statements and nothing else. There is no
 * DELETE, UPDATE, INSERT, TRUNCATE, DROP or ALTER anywhere in it, and no write
 * path exists to guard. It prints the resolved DB host before querying so the
 * target is proven rather than assumed (prod-db-guard step 3).
 *
 * Run:  pnpm exec tsx scripts/page-traffic-readonly.mts
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set — refusing to guess a target.");
  process.exit(1);
}

const parsed = new URL(url);
console.log(`DB host   : ${parsed.hostname}`);
console.log(`DB name   : ${parsed.pathname.replace(/^\//, "")}`);
console.log(`user      : ${parsed.username ? parsed.username.slice(0, 4) + "…" : "(none)"}`);
console.log("mode      : READ-ONLY (SELECT only)\n");

const conn = await mysql.createConnection({
  uri: url,
  ssl: { rejectUnauthorized: true },
});

try {
  const [[span]] = (await conn.query(
    `SELECT MIN(date) AS first_date, MAX(date) AS last_date,
            COUNT(*) AS rows_total, COUNT(DISTINCT page) AS distinct_pages
       FROM search_performance`,
  )) as any[];
  console.log("=== coverage window (state the window; never call a zero conclusive) ===");
  console.log(
    `first=${span.first_date}  last=${span.last_date}  rows=${Number(span.rows_total).toLocaleString()}  distinct_pages=${span.distinct_pages}\n`,
  );

  const [top] = (await conn.query(
    `SELECT page,
            SUM(clicks)      AS clicks,
            SUM(impressions) AS impressions,
            ROUND(AVG(position)/100, 1) AS avg_pos
       FROM search_performance
      WHERE date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
        AND page IS NOT NULL
      GROUP BY page
      ORDER BY clicks DESC
      LIMIT 25`,
  )) as any[];
  console.log("=== top 25 pages by clicks, last 90 days ===");
  for (const r of top as any[]) {
    console.log(
      `${String(r.clicks).padStart(6)} clicks  ${String(r.impressions).padStart(8)} impr  pos ${String(r.avg_pos).padStart(5)}  ${r.page}`,
    );
  }

  const [zero] = (await conn.query(
    `SELECT page,
            SUM(clicks)      AS clicks,
            SUM(impressions) AS impressions
       FROM search_performance
      WHERE date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
        AND page IS NOT NULL
      GROUP BY page
     HAVING clicks = 0
      ORDER BY impressions DESC
      LIMIT 30`,
  )) as any[];
  console.log(`\n=== pages with impressions but ZERO clicks in 90d (${(zero as any[]).length} shown) ===`);
  for (const r of zero as any[]) {
    console.log(`${String(r.impressions).padStart(8)} impr  0 clicks  ${r.page}`);
  }

  const [moes] = (await conn.query(
    `SELECT page, SUM(clicks) AS clicks, SUM(impressions) AS impressions,
            ROUND(AVG(position)/100, 1) AS avg_pos
       FROM search_performance
      WHERE date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
        AND page LIKE '%moes%'
      GROUP BY page
      ORDER BY clicks DESC`,
  )) as any[];
  console.log("\n=== the Moe's bridge pages (the mandate wanted these deleted) ===");
  if ((moes as any[]).length === 0) console.log("  no rows in window");
  for (const r of moes as any[]) {
    console.log(
      `${String(r.clicks).padStart(6)} clicks  ${String(r.impressions).padStart(8)} impr  pos ${String(r.avg_pos).padStart(5)}  ${r.page}`,
    );
  }

  const [cmp] = (await conn.query(
    `SELECT page, SUM(clicks) AS clicks, SUM(impressions) AS impressions
       FROM search_performance
      WHERE date >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)
        AND page LIKE '%compare%'
      GROUP BY page
      ORDER BY clicks DESC
      LIMIT 20`,
  )) as any[];
  console.log("\n=== comparison pages (mandate wants ~14 -> 1-2) ===");
  if ((cmp as any[]).length === 0) console.log("  no rows in window");
  for (const r of cmp as any[]) {
    console.log(`${String(r.clicks).padStart(6)} clicks  ${String(r.impressions).padStart(8)} impr  ${r.page}`);
  }
} finally {
  await conn.end();
}
