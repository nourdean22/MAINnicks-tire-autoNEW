/**
 * Wave-97 diagnostic — one-shot DB sanity check.
 *
 * Reports invoice population breakdown so we can confirm wave-97 fixes
 * land cleanly and pre/post numbers match expectations.
 *
 * Usage: pnpm tsx scripts/diagnose-invoice-population.ts
 */
import "dotenv/config";
import mysql from "mysql2/promise";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL missing");
    process.exit(1);
  }

  const conn = await mysql.createConnection(url);
  try {
    console.log("\n═══ INVOICES TABLE BREAKDOWN ═══\n");

    const queries: Array<{ label: string; sql: string }> = [
      { label: "Total rows", sql: "SELECT COUNT(*) as c FROM invoices" },
      { label: "By paymentStatus", sql: "SELECT paymentStatus, COUNT(*) as c, ROUND(SUM(totalAmount)/100, 2) as totalDollars FROM invoices GROUP BY paymentStatus ORDER BY c DESC" },
      { label: "By source", sql: "SELECT source, COUNT(*) as c FROM invoices GROUP BY source ORDER BY c DESC" },
      { label: "Estimate#-prefixed (leaked)", sql: "SELECT COUNT(*) as c FROM invoices WHERE invoiceNumber LIKE 'Estimate#%'" },
      { label: "Real invoices (Invoice# prefix)", sql: "SELECT COUNT(*) as c FROM invoices WHERE invoiceNumber LIKE 'Invoice#%'" },
      { label: "No prefix / other", sql: "SELECT COUNT(*) as c FROM invoices WHERE invoiceNumber NOT LIKE 'Invoice#%' AND invoiceNumber NOT LIKE 'Estimate#%'" },
      { label: "Pending > 7d (action-items target)", sql: "SELECT COUNT(*) as c, ROUND(SUM(totalAmount)/100, 2) as totalDollars FROM invoices WHERE paymentStatus = 'pending' AND invoiceDate < DATE_SUB(NOW(), INTERVAL 7 DAY)" },
      { label: "Pending > 7d (after wave-97 filter)", sql: "SELECT COUNT(*) as c, ROUND(SUM(totalAmount)/100, 2) as totalDollars FROM invoices WHERE paymentStatus = 'pending' AND invoiceNumber NOT LIKE 'Estimate#%' AND invoiceDate < DATE_SUB(NOW(), INTERVAL 7 DAY)" },
      { label: "Last 30d — paid only (revenue)", sql: "SELECT COUNT(*) as c, ROUND(SUM(totalAmount)/100, 2) as totalDollars FROM invoices WHERE invoiceDate >= DATE_SUB(NOW(), INTERVAL 30 DAY) AND paymentStatus = 'paid'" },
      { label: "Last 30d — ALL rows (old count)", sql: "SELECT COUNT(*) as c FROM invoices WHERE invoiceDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)" },
      { label: "ALG estimates total", sql: "SELECT COUNT(*) as c FROM alg_estimates" },
      { label: "ALG estimates unmatched (declined work)", sql: "SELECT COUNT(*) as c, ROUND(SUM(estimated_amount)/100, 2) as totalDollars FROM alg_estimates WHERE matched_invoice_id IS NULL" },
    ];

    for (const q of queries) {
      const [rows] = await conn.execute(q.sql);
      console.log(`▸ ${q.label}:`);
      console.log("  " + JSON.stringify(rows, null, 2).split("\n").join("\n  "));
      console.log();
    }
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("Crashed:", err);
  process.exit(1);
});
