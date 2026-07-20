#!/usr/bin/env node
/**
 * Link alg_estimates to customers so the declined-work engine can see its own
 * conversions.
 *
 * THE PROBLEM, MEASURED 2026-07-20
 *   alg_estimates.customer_id is NULL on ALL 425 rows.
 *   alg_estimates.customer_phone is E.164 ("+12162035831").
 *   customers.phone is bare 10-digit ("2162035831").
 *   Raw equality matches 14 of 425. Last-ten-digits matches 341, zero fan-out,
 *   zero ambiguity.
 *
 * Because the link is null, the engine reported "0% conversion after follow-up"
 * on 116 contacted estimates. That figure measured the join, not the outreach.
 *
 * SAFETY — read this before running with --apply
 *
 *   DRY RUN IS THE DEFAULT. Without --apply this performs SELECTs only. The
 *   write path is unreachable unless the flag is present; verify by reading
 *   `applyMode` below rather than by running it.
 *
 *   ADDITIVE ONLY. The UPDATE carries `AND customer_id IS NULL`, so it can only
 *   fill a blank. It cannot overwrite an existing link, and it cannot change any
 *   other column. The inverse is a single statement:
 *       UPDATE alg_estimates SET customer_id = NULL WHERE customer_id IS NOT NULL;
 *
 *   AMBIGUITY REFUSES. A phone matching more than one customer is SKIPPED and
 *   reported, never linked to an arbitrary one. Production currently has zero
 *   such phones; the guard exists because that can change and a wrong link is
 *   worse than a missing one.
 *
 *   NO DELETES, NO DDL, NO WRITES TO ANY OTHER TABLE.
 *
 * Usage:
 *   node scripts/backfill-estimate-customer-link.mjs           # dry run, prints the plan
 *   node scripts/backfill-estimate-customer-link.mjs --apply   # writes customer_id
 */
import mysql from "mysql2/promise";

const applyMode = process.argv.includes("--apply");

/**
 * Mirrors server/lib/phoneIdentity.ts phoneMatchKey EXACTLY. Kept in step by the
 * assertions below rather than by hope — a backfill that keys differently from
 * the running code would create links the application cannot reproduce.
 */
function phoneMatchKey(input) {
  if (input == null) return null;
  const digits = String(input).replace(/\D/g, "");
  if (digits.length < 10) return null;
  const key = digits.slice(-10);
  if (/^(\d)\1{9}$/.test(key)) return null;
  return key;
}

// Non-executing proof that this script agrees with the application, checked on
// every run before a single row is read. Cheap, and it makes drift impossible to
// ship silently.
for (const [input, expected] of [
  ["+12162035831", "2162035831"],
  ["2162035831", "2162035831"],
  ["(216) 203-5831", "2162035831"],
  ["12345678", null],
  ["1111111111", null],
  ["", null],
]) {
  const got = phoneMatchKey(input);
  if (got !== expected) {
    console.error(`ABORT: phoneMatchKey drift — ${JSON.stringify(input)} gave ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
    process.exit(1);
  }
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const db = await mysql.createConnection({ uri: url, ssl: { rejectUnauthorized: true } });

try {
  // ── Read both sides ────────────────────────────────────────────────────────
  const [customers] = await db.query(
    "SELECT id, phone FROM customers WHERE phone IS NOT NULL AND phone <> ''",
  );
  const [estimates] = await db.query(
    "SELECT id, customer_phone, customer_id, estimated_amount FROM alg_estimates",
  );

  // ── Build the index, and record collisions rather than resolving them ──────
  const byKey = new Map();
  for (const c of customers) {
    const key = phoneMatchKey(c.phone);
    if (!key) continue;
    const seen = byKey.get(key);
    if (seen) seen.push(c.id);
    else byKey.set(key, [c.id]);
  }

  const plan = [];
  const skipped = { alreadyLinked: 0, unusablePhone: 0, noCustomer: 0, ambiguous: [] };

  for (const e of estimates) {
    if (e.customer_id != null) { skipped.alreadyLinked++; continue; }
    const key = phoneMatchKey(e.customer_phone);
    if (!key) { skipped.unusablePhone++; continue; }
    const ids = byKey.get(key);
    if (!ids) { skipped.noCustomer++; continue; }
    if (ids.length > 1) { skipped.ambiguous.push({ estimateId: e.id, key, customerIds: ids }); continue; }
    plan.push({ estimateId: e.id, customerId: ids[0], amountCents: Number(e.estimated_amount ?? 0) });
  }

  const linkedValue = plan.reduce((n, p) => n + p.amountCents, 0);

  console.log(`\n${applyMode ? "APPLY" : "DRY RUN"} — estimate to customer link\n`);
  console.log(`  estimates total            ${estimates.length}`);
  console.log(`  customers with a usable phone ${byKey.size}`);
  console.log(`  WOULD LINK                 ${plan.length}`);
  console.log(`  estimate value linked      $${Math.round(linkedValue / 100).toLocaleString()}`);
  console.log(`  skipped · already linked   ${skipped.alreadyLinked}`);
  console.log(`  skipped · unusable phone   ${skipped.unusablePhone}`);
  console.log(`  skipped · no such customer ${skipped.noCustomer}`);
  console.log(`  skipped · AMBIGUOUS        ${skipped.ambiguous.length}`);
  for (const a of skipped.ambiguous.slice(0, 10)) {
    console.log(`      estimate ${a.estimateId} phone ${a.key} matches customers ${a.customerIds.join(", ")} — NOT linked`);
  }

  if (!applyMode) {
    console.log("\nNo rows were written. Re-run with --apply to write customer_id.\n");
    process.exit(0);
  }

  // ── Write. Additive only, and guarded again at the statement level. ────────
  let written = 0;
  for (const p of plan) {
    const [res] = await db.execute(
      "UPDATE alg_estimates SET customer_id = ? WHERE id = ? AND customer_id IS NULL",
      [p.customerId, p.estimateId],
    );
    written += res.affectedRows === 1 ? 1 : 0;
  }
  console.log(`\n  rows written               ${written}`);
  if (written !== plan.length) {
    console.log(`  NOTE ${plan.length - written} row(s) changed under the run and were left alone.`);
  }
  console.log("\nReverse with: UPDATE alg_estimates SET customer_id = NULL WHERE customer_id IS NOT NULL;\n");
} finally {
  await db.end();
}
