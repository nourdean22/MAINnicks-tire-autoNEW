/**
 * READ-ONLY diagnostic. Reports the current unique-key state on
 * search_performance and quantifies any device/country/searchType
 * collapse caused by the narrow-key bug fixed 2026-07-11 (see
 * server/routers/nick/intelligence.ts). Writes nothing.
 *
 * Run: cd apps/nickstire && pnpm exec tsx scripts/diagnostics/gsc-index-probe.ts
 */
import dotenv from "dotenv";
import { resolve } from "path";
import mysql from "mysql2/promise";

dotenv.config({ path: resolve(process.cwd(), ".env") });
dotenv.config({ path: resolve(process.cwd(), "..", "..", ".env") });

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  if (!url.startsWith("mysql://")) {
    throw new Error(`DATABASE_URL is not mysql:// (got "${url.split("://")[0]}://..."). Refusing.`);
  }

  const conn = await mysql.createConnection(url);
  try {
    const [indexRows] = await conn.query<mysql.RowDataPacket[]>(
      "SHOW INDEX FROM search_performance",
    );
    const byKey = new Map<string, string[]>();
    for (const row of indexRows) {
      const list = byKey.get(row.Key_name) ?? [];
      list.push(`${row.Column_name}${row.Sub_part ? `(${row.Sub_part})` : ""}`);
      byKey.set(row.Key_name, list);
    }
    console.log("Current indexes on search_performance:");
    for (const [name, cols] of byKey) {
      console.log(`  ${name}: (${cols.join(", ")})`);
    }

    const hasNarrow = byKey.has("uq_search_perf_date_query_page");
    const hasWide = byKey.has("uq_search_perf_date_query_page_device_country_type");
    console.log(`\nNarrow key present: ${hasNarrow}`);
    console.log(`Wide key present: ${hasWide}`);
    if (hasNarrow) {
      console.log(
        "\nWARNING: narrow key is live. Every prior click of the admin \"Run migrations\"\n" +
          "endpoint collapsed device/country/searchType breakdowns. Row-count-per-day is\n" +
          "the best available signal of collapse (a healthy day should show >1 row per\n" +
          "(date, query, page) when multiple devices/countries/searchTypes appear).",
      );
    }

    const [collapseRows] = await conn.query<mysql.RowDataPacket[]>(`
      SELECT date, COUNT(*) AS rows_for_date,
             COUNT(DISTINCT CONCAT(device, '|', country, '|', searchType)) AS distinct_dims
      FROM search_performance
      GROUP BY date
      ORDER BY date DESC
      LIMIT 14
    `);
    console.log("\nLast 14 days — rows vs distinct (device,country,searchType) combos seen:");
    for (const r of collapseRows) {
      console.log(`  ${r.date}: ${r.rows_for_date} rows, ${r.distinct_dims} distinct dims`);
    }
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
