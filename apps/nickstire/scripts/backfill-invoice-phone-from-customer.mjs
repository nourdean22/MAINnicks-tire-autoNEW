/**
 * Backfill invoices.customerPhone (and customerId) for ALG/ShopDriver invoices
 * that imported without a phone.
 *
 * WHY THIS EXISTS
 * ShopDriver's ALG ticket payloads frequently omit the phone. shopDriverMirror.ts
 * already compensates: it matches the ticket's "LAST, FIRST" customerName against
 * the customers table and copies that customer's phone onto the invoice
 * (see the "Root-cause fix" block at shopDriverMirror.ts:923).
 *
 * That compensation silently no-ops for a whole class of names, because the
 * firstName comparison is case-SENSITIVE:
 *
 *     candidates.filter(c => c.firstName === firstName)   // shopDriverMirror.ts:914
 *
 * ALG sends casing inconsistently — "WILLIAMS, RORY" alongside "Pryor, Donald".
 * The SQL that fetches candidates matches lastName case-insensitively (MySQL's
 * default collation), but this JS filter then drops every all-caps first name,
 * so `filtered.length` is 0 rather than 1 and no phone is ever copied.
 *
 * This script applies the same matching rule the mirror intends, case-insensitively,
 * to the historical rows the bug already left behind.
 *
 * SAFETY
 * - DRY RUN by default. Pass --apply to write.
 * - Matches ONLY when exactly one customer matches. Ambiguous names are skipped,
 *   never guessed — same rule as the mirror (`filtered.length === 1`).
 * - UPDATE is guarded on the row still being unfixed, so a concurrent mirror run
 *   that fixes a row first is never overwritten.
 * - Writes a backup table before applying; every change is reversible from it.
 * - Re-reads the rows afterward and fails loudly if the count doesn't match.
 *
 * Run:
 *   node scripts/backfill-invoice-phone-from-customer.mjs            # dry run
 *   node scripts/backfill-invoice-phone-from-customer.mjs --apply    # write
 */
import mysql from "mysql2/promise";
import fs from "fs";
import path from "path";

const APPLY = process.argv.includes("--apply");
const STAMP = "20260801";
const BACKUP = `_bak_invoice_phone_${STAMP}`;

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = path.join(process.cwd(), ".env");
  const line = fs
    .readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith("DATABASE_URL="));
  if (!line) throw new Error("DATABASE_URL not set and not found in .env");
  return line.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
}

/** Same parse as shopDriverMirror.ts:905-909 — "LAST, FIRST" or bare name. */
function parseName(raw) {
  const s = String(raw || "").trim();
  const parts = s.includes(",") ? s.split(",").map((x) => x.trim()) : [s];
  return { last: parts[0] || "", first: parts[1] || "" };
}

/** Same normalizer as shopDriverMirror.ts:655 — bare 10-digit, no country code. */
function normalizePhone(raw) {
  if (!raw) return "";
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

/**
 * Compare two name parts. Trims and lowercases both sides: the customers table
 * carries trailing spaces on some imported names ("Erica ", "CHERYL "), and the
 * shipped `c.firstName === firstName` in shopDriverMirror.ts:914 trims neither,
 * so those rows never match even when they are the only candidate.
 */
const eqi = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

/** A name part that carries no identifying information — junk import rows. */
const isJunkName = (s) => !String(s || "").trim().replace(/[^a-z0-9]/gi, "");

async function main() {
  const conn = await mysql.createConnection({
    uri: loadDatabaseUrl(),
    ssl: { rejectUnauthorized: true },
    connectTimeout: 60_000,
  });

  try {
    const [targets] = await conn.query(
      `SELECT id, customerName, invoiceNumber FROM invoices
       WHERE (customerPhone IS NULL OR customerPhone = '') AND customerId IS NULL
       ORDER BY id`,
    );
    console.log(`${APPLY ? "APPLY" : "DRY RUN"} — invoices missing phone and unlinked: ${targets.length}`);
    if (targets.length === 0) {
      console.log("Nothing to do.");
      return;
    }

    const lastNames = [...new Set(targets.map((r) => parseName(r.customerName).last).filter(Boolean))];
    const [cust] = await conn.query(
      `SELECT id, firstName, lastName, phone FROM customers WHERE lastName IN (?)`,
      [lastNames],
    );

    const byLast = new Map();
    for (const c of cust) {
      const k = String(c.lastName || "").trim().toLowerCase();
      if (!k) continue;
      if (!byLast.has(k)) byLast.set(k, []);
      byLast.get(k).push(c);
    }

    let shippedBehaviour = 0;
    const plan = [];
    const ambiguous = [];
    const noSuchLastName = [];   // customer base has nobody by that surname
    const firstNameMiss = [];    // surname exists, given name doesn't line up
    const unusablePhone = [];    // matched, but the customer's phone is junk
    const junk = [];             // name carries no identifying information at all

    for (const row of targets) {
      const { last, first } = parseName(row.customerName);
      // "-, Ara" and friends: no identifying surname, so no match is defensible.
      if (isJunkName(last)) {
        junk.push(row);
        continue;
      }
      const cands = byLast.get(last.trim().toLowerCase()) ?? [];
      if (cands.length === 0) {
        noSuchLastName.push(row);
        continue;
      }

      // What the currently-shipped case-sensitive filter would have matched.
      const cs = first ? cands.filter((c) => c.firstName === first) : cands;
      if (cs.length === 1) shippedBehaviour++;

      const hits = first ? cands.filter((c) => eqi(c.firstName, first)) : cands;
      if (hits.length === 1) {
        const phone = normalizePhone(hits[0].phone);
        if (phone.length < 10) {
          unusablePhone.push(row); // don't write junk onto the invoice
          continue;
        }
        plan.push({ invoiceId: row.id, name: row.customerName, customerId: hits[0].id, phone });
      } else if (hits.length > 1) {
        ambiguous.push({ row, n: hits.length });
      } else {
        firstNameMiss.push({ row, cands });
      }
    }

    console.log("");
    console.log(`recoverable (exactly one customer matches) : ${plan.length}`);
    console.log(`  of which the shipped case-sensitive filter would find: ${shippedBehaviour}`);
    console.log(`ambiguous — >1 customer, skipped not guessed: ${ambiguous.length}`);
    console.log(`surname not in customer base at all        : ${noSuchLastName.length}`);
    console.log(`surname present, given name doesn't match  : ${firstNameMiss.length}`);
    console.log(`matched but customer phone unusable        : ${unusablePhone.length}`);
    console.log(`unusable name on the invoice ("-, Ara")    : ${junk.length}`);
    console.log("");

    if (firstNameMiss.length) {
      console.log("given-name misses (surname exists — inspect before trusting):");
      for (const m of firstNameMiss.slice(0, 10)) {
        const opts = m.cands.map((c) => `${c.firstName} ${c.lastName}`).join(" / ");
        console.log(`  inv ${String(m.row.id).padEnd(7)} "${m.row.customerName}"  vs  ${opts}`);
      }
      if (firstNameMiss.length > 10) console.log(`  ... and ${firstNameMiss.length - 10} more`);
      console.log("");
    }

    for (const p of plan.slice(0, 10)) {
      console.log(`  inv ${String(p.invoiceId).padEnd(7)} "${p.name}" -> customer #${p.customerId} phone ${p.phone}`);
    }
    if (plan.length > 10) console.log(`  ... and ${plan.length - 10} more`);

    if (ambiguous.length) {
      console.log("\nambiguous (left alone):");
      for (const a of ambiguous.slice(0, 5)) console.log(`  inv ${a.row.id} "${a.row.customerName}" — ${a.n} candidates`);
    }

    if (!APPLY) {
      console.log("\nDRY RUN — nothing written. Re-run with --apply to write.");
      return;
    }
    if (plan.length === 0) {
      console.log("\nNothing recoverable. Nothing written.");
      return;
    }

    // Reversible backup: restore with UPDATE invoices SET customerPhone=NULL,
    // customerId=NULL WHERE id IN (SELECT invoice_id FROM <BACKUP>).
    await conn.query(`DROP TABLE IF EXISTS ${BACKUP}`);
    await conn.query(
      `CREATE TABLE ${BACKUP} (invoice_id INT PRIMARY KEY, set_customer_id INT, set_phone VARCHAR(30))`,
    );
    for (const p of plan) {
      await conn.query(`INSERT INTO ${BACKUP} (invoice_id, set_customer_id, set_phone) VALUES (?,?,?)`, [
        p.invoiceId,
        p.customerId,
        p.phone,
      ]);
    }
    console.log(`\nbackup written: ${BACKUP} (${plan.length} rows)`);

    let written = 0;
    for (const p of plan) {
      // Guarded: only touch a row that is still unfixed. If the mirror repaired
      // it between the SELECT and now, affectedRows is 0 and we leave it alone.
      const [res] = await conn.query(
        `UPDATE invoices SET customerPhone = ?, customerId = ?
         WHERE id = ? AND customerId IS NULL AND (customerPhone IS NULL OR customerPhone = '')`,
        [p.phone, p.customerId, p.invoiceId],
      );
      if (res.affectedRows === 1) written++;
    }
    console.log(`updated: ${written} / ${plan.length}`);

    const [after] = await conn.query(
      `SELECT COUNT(*) c FROM invoices WHERE customerPhone IS NULL OR customerPhone = ''`,
    );
    console.log(`invoices still missing phone: ${after[0].c} (was ${targets.length})`);
    if (written !== plan.length) {
      console.log(`NOTE: ${plan.length - written} row(s) were changed by something else first — left as found.`);
    }
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
