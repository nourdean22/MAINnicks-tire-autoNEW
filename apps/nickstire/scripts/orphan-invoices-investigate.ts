/**
 * READ-ONLY orphan-invoice scoping. Orphan = invoices.customerId IS NULL.
 * Buckets them by linkability: by phone (reliable) vs by name.
 * Run: railway run -s MAINnicks-tire-auto pnpm exec tsx scripts/orphan-invoices-investigate.ts
 *
 * NAME MATCHING (fixed 2026-08-01, PR #1284 follow-up)
 * invoices.customerName arrives in TWO shapes depending on which importer wrote it:
 *   - "LAST, FIRST"  — shopDriverMirror.ts (the ALG mirror; the large majority)
 *   - "First Last"   — routers/shopdriver.ts:630, which joins first+last itself
 * This script previously compared ONLY
 *     UPPER(TRIM(CONCAT_WS(' ',c.firstName,c.lastName))) = UPPER(TRIM(i.customerName))
 * which builds "First Last" and therefore could never match a "LAST, FIRST" row.
 * It reported linkable_by_unique_name = 0 regardless of the truth — a wrong number
 * that read like a real finding. Both shapes are handled below.
 *
 * Counts are reported as no-match / exactly-one / ambiguous rather than a single
 * "linkable" total, so a zero is interpretable instead of mysterious. Only the
 * exactly-one bucket is safe to act on; ambiguous names must never be guessed
 * (see shopDriverMirror.ts — `filtered.length === 1`).
 *
 * COLLATION — the reason this is not a plain `=`.
 * customers.firstName and customers.lastName are declared utf8mb4_bin: case
 * SENSITIVE and NO PAD, regardless of the connection collation (which is
 * utf8mb4_unicode_ci). So `c.lastName = 'Aiken'` does NOT find the stored
 * 'AIKEN', and `c.firstName = 'Erica'` does NOT find the stored 'Erica '.
 * Verified 2026-08-01 against customer #1696:
 *     lastName = "Aiken" -> 0 rows | lastName = "AIKEN" -> 1 row
 * ALG varies casing per ticket, so an exact-binary compare drops real matches.
 * Forcing utf8mb4_unicode_ci on the customer side fixes case and trailing space
 * together. It costs the lastName index, which is acceptable here: this is a
 * read-only scoping script, not a hot path.
 */
import mysql from "mysql2/promise";

/** Given-name half of the invoice name, for either shape. */
const INV_FIRST = `TRIM(SUBSTRING_INDEX(i.customerName, ',', -1))`;
/** Surname half of the invoice name, for either shape. */
const INV_LAST = `TRIM(SUBSTRING_INDEX(i.customerName, ',', 1))`;

/**
 * Collapse internal whitespace runs. Real data carries "Doretha  Cox" (two
 * spaces) while CONCAT_WS emits one, so the joined form would never equal the
 * stored form. POSIX [[:space:]] avoids backslash-escaping: a '\s' written here
 * reaches MySQL as a bare 's' and silently matches the wrong thing.
 */
const squash = (expr: string) => `REGEXP_REPLACE(${expr}, '[[:space:]]+', ' ')`;

/** Escape the utf8mb4_bin columns into a case-insensitive, PAD SPACE comparison. */
const CI = (expr: string) => `(${expr}) COLLATE utf8mb4_unicode_ci`;

/** Join predicate covering both "LAST, FIRST" and "First Last". */
const NAME_MATCH = `(
  (i.customerName LIKE '%,%'
     AND ${CI("c.lastName")}  = ${INV_LAST}
     AND ${CI("c.firstName")} = ${INV_FIRST})
  OR
  (i.customerName NOT LIKE '%,%'
     AND ${CI(squash(`CONCAT_WS(' ', c.firstName, c.lastName)`))} = ${squash(`TRIM(i.customerName)`)})
)`;

/** Invoices with no phone we could link by instead. */
const NO_USABLE_PHONE = `(i.customerPhone IS NULL OR CHAR_LENGTH(REGEXP_REPLACE(i.customerPhone,'[^0-9]',''))<10)`;

async function main() {
  const uri = process.env.DATABASE_URL;
  if (!uri) { console.error("DATABASE_URL not set"); process.exit(1); }
  // ssl passed explicitly: the TiDB URL carries `?ssl={rejectUnauthorized:true}`,
  // which mysql2 otherwise reads as the NAME of a built-in SSL profile and throws
  // "Unknown SSL profile". Same options the backfill script uses.
  const conn = await mysql.createConnection({
    uri,
    ssl: { rejectUnauthorized: true },
    connectTimeout: 60_000,
  });
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

    // Which name shape are we actually dealing with? If this is all one shape,
    // a bug in the other branch of NAME_MATCH would be invisible — so print it.
    await show("NAME SHAPE of unlinked invoices", `SELECT
      SUM(customerName LIKE '%,%') last_comma_first,
      SUM(customerName NOT LIKE '%,%') first_space_last,
      SUM(TRIM(REGEXP_REPLACE(customerName,'[^a-zA-Z0-9]','')) = '') unusable_name
      FROM invoices WHERE customerId IS NULL`);

    await show("LINKABLE BY PHONE — unlinked invoice phone matches exactly one customer (last-10)", `
      SELECT COUNT(*) linkable_by_phone FROM invoices i
      WHERE i.customerId IS NULL AND CHAR_LENGTH(REGEXP_REPLACE(i.customerPhone,'[^0-9]',''))>=10
        AND (SELECT COUNT(*) FROM customers c
             WHERE RIGHT(REGEXP_REPLACE(c.phone,'[^0-9]',''),10)=RIGHT(REGEXP_REPLACE(i.customerPhone,'[^0-9]',''),10))=1`);

    // Single grouped pass rather than a correlated per-row subquery: the old
    // shape re-scanned customers once per invoice and is what makes this table
    // hang on prod TiDB.
    await show("BY NAME — no usable phone, bucketed by how many customers match", `
      SELECT
        SUM(m = 0) no_customer_matches,
        SUM(m = 1) exactly_one_SAFE_TO_LINK,
        SUM(m > 1) ambiguous_DO_NOT_GUESS
      FROM (
        SELECT i.id, COUNT(c.id) m
        FROM invoices i
        LEFT JOIN customers c ON ${NAME_MATCH}
        WHERE i.customerId IS NULL AND ${NO_USABLE_PHONE}
        GROUP BY i.id
      ) t`);

    await show("SAMPLE — unlinked, no phone, exactly one customer matches (the actionable set)", `
      SELECT i.id, i.customerName, c.id customer_id, c.firstName, c.lastName, c.phone
      FROM invoices i
      JOIN customers c ON ${NAME_MATCH}
      WHERE i.customerId IS NULL AND ${NO_USABLE_PHONE}
        AND (SELECT COUNT(*) FROM customers c2
             WHERE ${NAME_MATCH.replace(/\bc\./g, "c2.")}) = 1
      ORDER BY i.id LIMIT 10`);

    await show("SAMPLE 10 unlinked invoices", `SELECT id, customerName, customerPhone, ROUND(totalAmount/100) amt, paymentStatus
      FROM invoices WHERE customerId IS NULL ORDER BY totalAmount DESC LIMIT 10`);
  } finally { await conn.end(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
