/**
 * (d) Link the unlinked invoices (customerId IS NULL) whose customerPhone matches
 * EXACTLY ONE customer by last-10 (reliable). Anonymous walk-ins/estimates with no
 * match are left alone (not fabricated). Backup + transaction + verify.
 * Run: railway run -s MAINnicks-tire-auto pnpm exec tsx scripts/orphan-invoices-link.ts
 */
import mysql from "mysql2/promise";

const STAMP = "20260603";

async function main() {
  const uri = process.env.DATABASE_URL;
  if (!uri) { console.error("DATABASE_URL not set"); process.exit(1); }
  const conn = await mysql.createConnection({ uri });
  try {
    // Resolve the safe link set in JS (invoice_id -> matched customer id).
    const [matches] = (await conn.query(`
      SELECT i.id AS invoice_id, c.id AS customer_id
      FROM invoices i
      JOIN customers c
        ON RIGHT(REGEXP_REPLACE(c.phone,'[^0-9]',''),10) = RIGHT(REGEXP_REPLACE(i.customerPhone,'[^0-9]',''),10)
      WHERE i.customerId IS NULL
        AND CHAR_LENGTH(REGEXP_REPLACE(i.customerPhone,'[^0-9]','')) >= 10
        AND (SELECT COUNT(*) FROM customers c2
             WHERE RIGHT(REGEXP_REPLACE(c2.phone,'[^0-9]',''),10) = RIGHT(REGEXP_REPLACE(i.customerPhone,'[^0-9]',''),10)) = 1
    `)) as any;
    const rows = matches as Array<{ invoice_id: number; customer_id: number }>;
    console.log(`\n=== ORPHAN-INVOICE LINK: ${rows.length} invoices safely linkable by phone ===`);
    if (rows.length === 0) { console.log("Nothing to link."); return; }
    console.log(JSON.stringify(rows, null, 2));

    // Backup (reversible): invoice_id -> set back to NULL to undo.
    await conn.query(`DROP TABLE IF EXISTS _bak_orphan_inv_link_${STAMP}`);
    await conn.query(`CREATE TABLE _bak_orphan_inv_link_${STAMP} (invoice_id INT, linked_customer_id INT)`);

    await conn.beginTransaction();
    try {
      for (const { invoice_id, customer_id } of rows) {
        await conn.query(`INSERT INTO _bak_orphan_inv_link_${STAMP} (invoice_id, linked_customer_id) VALUES (?, ?)`, [invoice_id, customer_id]);
        await conn.query(`UPDATE invoices SET customerId = ? WHERE id = ? AND customerId IS NULL`, [customer_id, invoice_id]);
      }
      const [stillNull] = (await conn.query(
        `SELECT COUNT(*) c FROM invoices WHERE id IN (?) AND customerId IS NULL`, [rows.map((r) => r.invoice_id)],
      )) as any;
      if ((stillNull as any)[0].c !== 0) {
        await conn.rollback();
        console.error("VERIFY FAILED — some targeted invoices still NULL. ROLLED BACK.");
        process.exit(1);
      }
      await conn.commit();
      const [remaining] = (await conn.query("SELECT COUNT(*) c FROM invoices WHERE customerId IS NULL")) as any;
      console.log(`LINKED ${rows.length} invoices. Unlinked invoices now: ${(remaining as any)[0].c} (was 317; remainder = anonymous walk-ins/estimates with no matching customer).`);
    } catch (e) {
      await conn.rollback();
      console.error("LINK ERROR — ROLLED BACK:", e);
      process.exit(1);
    }
  } finally {
    await conn.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
