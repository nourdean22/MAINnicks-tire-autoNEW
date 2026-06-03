/**
 * READ-ONLY (d) orphan-invoice scoping. Orphan = invoices.customerId IS NULL.
 * Buckets them by linkability: by phone (reliable) vs name-only (fuzzy/hold).
 * Run: railway run -s MAINnicks-tire-auto pnpm exec tsx scripts/orphan-invoices-investigate.ts
 */
import mysql from "mysql2/promise";

async function main() {
  const uri = process.env.DATABASE_URL;
  if (!uri) { console.error("DATABASE_URL not set"); process.exit(1); }
  const conn = await mysql.createConnection({ uri });
  const show = async (label: string, sql: string) => {
    const [r] = await conn.query(sql);
    console.log(`\n=== ${label} ===`);
    console.log(JSON.stringify(r, null, 2));
  };
  try {
    await show("INVOICE TOTALS", `SELECT COUNT(*) total,
      SUM(customerId IS NULL) unlinked,
      SUM(customerPhone IS NULL OR customerPhone='') missing_phone FROM invoices`);
    await show("UNLINKED breakdown (customerId IS NULL)", `SELECT
      COUNT(*) unlinked,
      SUM(customerPhone IS NOT NULL AND customerPhone<>'' AND CHAR_LENGTH(REGEXP_REPLACE(customerPhone,'[^0-9]',''))>=10) has_usable_phone,
      SUM(customerPhone IS NULL OR customerPhone='' OR CHAR_LENGTH(REGEXP_REPLACE(customerPhone,'[^0-9]',''))<10) no_usable_phone
      FROM invoices WHERE customerId IS NULL`);
    await show("LINKABLE BY PHONE — unlinked invoice phone matches exactly one customer (last-10)", `
      SELECT COUNT(*) linkable_by_phone FROM invoices i
      WHERE i.customerId IS NULL AND CHAR_LENGTH(REGEXP_REPLACE(i.customerPhone,'[^0-9]',''))>=10
        AND (SELECT COUNT(*) FROM customers c
             WHERE RIGHT(REGEXP_REPLACE(c.phone,'[^0-9]',''),10)=RIGHT(REGEXP_REPLACE(i.customerPhone,'[^0-9]',''),10))=1`);
    await show("LINKABLE BY EXACT NAME — no usable phone, name matches exactly one customer", `
      SELECT COUNT(*) linkable_by_unique_name FROM invoices i
      WHERE i.customerId IS NULL AND (i.customerPhone IS NULL OR CHAR_LENGTH(REGEXP_REPLACE(i.customerPhone,'[^0-9]',''))<10)
        AND (SELECT COUNT(*) FROM customers c
             WHERE UPPER(TRIM(CONCAT_WS(' ',c.firstName,c.lastName)))=UPPER(TRIM(i.customerName)))=1`);
    await show("SAMPLE 10 unlinked invoices", `SELECT id, customerName, customerPhone, ROUND(totalAmount/100) amt, paymentStatus
      FROM invoices WHERE customerId IS NULL ORDER BY totalAmount DESC LIMIT 10`);
  } finally { await conn.end(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
