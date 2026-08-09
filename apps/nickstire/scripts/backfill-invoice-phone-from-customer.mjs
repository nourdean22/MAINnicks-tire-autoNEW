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

/**
 * Order-insensitive name key, for comparing across tables that disagree about
 * name order: invoices store "LAST, FIRST", alg_estimates stores "First Last".
 * Sorting the tokens makes the two comparable without guessing which is which.
 */
const tokenKey = (s) =>
  String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
    .split(" ").filter(Boolean).sort().join(" ");

/** Placeholder numbers staff type to satisfy a required field. Never real. */
const JUNK_PHONES = new Set(["1111111111", "0000000000", "1234567890", "9999999999"]);

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
    // COLLATE, not a bare IN: customers.lastName is utf8mb4_bin (case sensitive,
    // NO PAD), so `IN ('Williams')` does not return the stored 'WILLIAMS'. Without
    // this the candidate never reaches the eqi() fold below and the row silently
    // looks unrecoverable. Observed directly: the candidate list for
    // "Williams, Terrence" returns 22 rows bare and 47 with COLLATE.
    const [cust] = await conn.query(
      `SELECT id, firstName, lastName, phone FROM customers
       WHERE lastName COLLATE utf8mb4_unicode_ci IN (?)`,
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

    // SECOND SOURCE — alg_estimates.
    //
    // A clarity-gate audit on 2026-08-01 caught this file's first version
    // claiming the leftovers had "no phone anywhere to recover". That was only
    // ever checked against `customers`. A sweep of all 30 tables carrying both a
    // name and a phone column found alg_estimates — the SAME ALG system these
    // invoices come from — holding an unambiguous phone for 19 of them.
    //
    // These get a phone but NOT a customerId: no customers row exists to point
    // at, and inventing one would be a different (unrequested) change.
    const stillMissing = [...noSuchLastName, ...firstNameMiss.map((m) => m.row), ...unusablePhone];
    const [est] = await conn.query(
      `SELECT customer_name nm, customer_phone ph FROM alg_estimates
       WHERE customer_phone IS NOT NULL AND customer_phone <> ''`,
    );
    const estByName = new Map();
    for (const e of est) {
      const k = tokenKey(e.nm);
      const p = normalizePhone(e.ph);
      if (!k || p.length !== 10 || JUNK_PHONES.has(p)) continue;
      if (!estByName.has(k)) estByName.set(k, new Set());
      estByName.get(k).add(p);
    }

    const estPlan = [];
    let estAmbiguous = 0;
    for (const row of stillMissing) {
      const hits = estByName.get(tokenKey(row.customerName));
      if (!hits) continue;
      if (hits.size === 1) estPlan.push({ invoiceId: row.id, name: row.customerName, phone: [...hits][0] });
      else estAmbiguous++;
    }

    console.log("");
    console.log(`recoverable (exactly one customer matches) : ${plan.length}`);
    console.log(`recoverable from alg_estimates (phone only): ${estPlan.length}`);
    console.log(`  ambiguous in alg_estimates, skipped      : ${estAmbiguous}`);
    console.log(`  of which the shipped case-sensitive filter would find: ${shippedBehaviour}`);
    console.log(`ambiguous — >1 customer, skipped not guessed: ${ambiguous.length}`);
    console.log(`surname not in customer base at all        : ${noSuchLastName.length}`);
    console.log(`surname present, given name doesn't match  : ${firstNameMiss.length}`);
    console.log(`matched but customer phone unusable        : ${unusablePhone.length}`);
    console.log(`unusable name on the invoice ("-, Ara")    : ${junk.length}`);
    const trulyUnrecoverable = stillMissing.length + junk.length - estPlan.length - estAmbiguous;
    console.log(`NO phone in customers OR alg_estimates      : ${trulyUnrecoverable}`);
    console.log("");

    if (estPlan.length) {
      console.log("recoverable from alg_estimates:");
      for (const p of estPlan.slice(0, 10)) {
        console.log(`  inv ${String(p.invoiceId).padEnd(7)} "${p.name}" -> phone ${p.phone} (no customer row; phone only)`);
      }
      if (estPlan.length > 10) console.log(`  ... and ${estPlan.length - 10} more`);
      console.log("");
    }

    if (firstNameMiss.length) {
      console.log("given-name misses (surname exists — inspect before trusting):");
      for (const m of firstNameMiss.slice(0, 10)) {
        const opts = m.cands.map((c) => `${c.firstName} ${c.lastName}`).join(" / ");
        console.log(`  inv ${String(m.row.id).padEnd(7)} "${m.row.customerName}"  vs  ${opts}`);
      }
      if (firstNameMiss.length > 10) console.log(`  ... and ${firstNameMiss.length - 10} more`);
      console.log("");
    }

    // 2026-08-09 · these previews used to print the customer's full name and
    // full phone. Opaque ids identify the row just as well for a sanity check,
    // and this output lands in a terminal that gets pasted into chats/tickets.
    // Only ONE of these two lines was ever flagged by lint:pii — see the
    // blind-spot note in scripts/lint-pii.mjs; the worse line was invisible.
    for (const p of plan.slice(0, 10)) {
      console.log(`  inv ${String(p.invoiceId).padEnd(7)} -> customer #${p.customerId} phone ***${String(p.phone ?? "").slice(-4)}`);
    }
    if (plan.length > 10) console.log(`  ... and ${plan.length - 10} more`);

    if (ambiguous.length) {
      console.log("\nambiguous (left alone):");
      for (const a of ambiguous.slice(0, 5)) console.log(`  inv ${a.row.id} — ${a.n} candidates`);
    }

    if (!APPLY) {
      console.log("\nDRY RUN — nothing written. Re-run with --apply to write.");
      return;
    }
    if (plan.length === 0 && estPlan.length === 0) {
      console.log("\nNothing recoverable. Nothing written.");
      return;
    }

    // Reversible backup: restore with UPDATE invoices SET customerPhone=NULL,
    // customerId=NULL WHERE id IN (SELECT invoice_id FROM <BACKUP>).
    //
    // CREATE IF NOT EXISTS + INSERT IGNORE, never DROP: this table already holds
    // the reversal set for rows applied by an earlier run. Dropping it would
    // leave those writes permanent and unwindable — the backup is only worth
    // anything if a second run cannot destroy the first run's copy.
    await conn.query(
      `CREATE TABLE IF NOT EXISTS ${BACKUP} (invoice_id INT PRIMARY KEY, set_customer_id INT, set_phone VARCHAR(30))`,
    );
    const allWrites = [
      ...plan.map((p) => ({ ...p, source: "customers" })),
      ...estPlan.map((p) => ({ ...p, customerId: null, source: "alg_estimates" })),
    ];
    for (const p of allWrites) {
      await conn.query(`INSERT IGNORE INTO ${BACKUP} (invoice_id, set_customer_id, set_phone) VALUES (?,?,?)`, [
        p.invoiceId,
        p.customerId,
        p.phone,
      ]);
    }
    const [bakN] = await conn.query(`SELECT COUNT(*) c FROM ${BACKUP}`);
    console.log(`\nbackup ${BACKUP}: ${bakN[0].c} rows total (this run added up to ${allWrites.length})`);

    let written = 0;
    let writtenEst = 0;
    for (const p of allWrites) {
      // Guarded: only touch a row that is still unfixed. If the mirror repaired
      // it between the SELECT and now, affectedRows is 0 and we leave it alone.
      // customerId is only set when a real customers row backed the match;
      // alg_estimates gives us a phone but no customer to point at.
      const [res] = p.customerId
        ? await conn.query(
            `UPDATE invoices SET customerPhone = ?, customerId = ?
             WHERE id = ? AND customerId IS NULL AND (customerPhone IS NULL OR customerPhone = '')`,
            [p.phone, p.customerId, p.invoiceId],
          )
        : await conn.query(
            `UPDATE invoices SET customerPhone = ?
             WHERE id = ? AND (customerPhone IS NULL OR customerPhone = '')`,
            [p.phone, p.invoiceId],
          );
      if (res.affectedRows === 1) {
        written++;
        if (p.source === "alg_estimates") writtenEst++;
      }
    }
    console.log(`updated: ${written} / ${allWrites.length}  (${writtenEst} of them phone-only from alg_estimates)`);

    const [after] = await conn.query(
      `SELECT COUNT(*) c FROM invoices WHERE customerPhone IS NULL OR customerPhone = ''`,
    );
    console.log(`invoices still missing phone: ${after[0].c} (targets this run: ${targets.length})`);
    if (written !== allWrites.length) {
      console.log(`NOTE: ${allWrites.length - written} row(s) were changed by something else first — left as found.`);
    }
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
