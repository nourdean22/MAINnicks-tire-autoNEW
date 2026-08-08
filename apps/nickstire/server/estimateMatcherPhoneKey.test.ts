/**
 * Estimate→invoice matcher · phone-identity regression.
 *
 * THE DEFECT (measured 2026-08-08). `backfillMatches` compared phones with
 * `eq(invoices.customerPhone, est.customerPhone)` — exact string equality — and
 * the two tables store different formats:
 *
 *   alg_estimates.customer_phone   +11234567890        (E.164)
 *   invoices.customerPhone         (216) 555-9999      (formatted, or bare-10)
 *
 * Those never compare equal, so the pass ran on every sync and matched nothing.
 * That is indistinguishable from "no matches exist" in every log and dashboard,
 * which is how a **1.1% lifetime match rate (5 of 437, all written on one day)**
 * survived three months.
 *
 * It was not cosmetic: `declinedWorkRecovery` reads `matched_invoice_id IS NULL`
 * as "the customer declined" and TEXTS THEM. An unmatchable row is a customer
 * who may have already paid.
 *
 * Read-only simulation before the fix — raw equality would match 1 row;
 * canonical matches 30 ($20,364); 171 distinct phones join instead of 17.
 *
 * This file pins the IDENTITY RULE, not the SQL. `smsPerformance.ts` carries the
 * same repair for the same reason; the point is that both sides go through the
 * one canon rather than a fourth hand-rolled normaliser.
 */
import { describe, expect, it } from "vitest";
import { PHONE_MATCH_KEY_SQL, phoneMatchKey } from "./lib/phoneIdentity";

/** Mirrors what MySQL's RIGHT(REGEXP_REPLACE(...)) does, for twin-parity checks. */
const sqlSideEquivalent = (raw: string): string => raw.replace(/[^0-9]/g, "").slice(-10);

describe("the JS and SQL twins agree — a divergence is a silent no-match", () => {
  it.each([
    ["+11234567890", "1234567890"],
    ["(216) 555-9999", "2165559999"],
    ["216-555-9999", "2165559999"],
    ["2165559999", "2165559999"],
    ["+1 (216) 555-9999", "2165559999"],
    ["1-216-555-9999", "2165559999"],
  ])("%s → %s on BOTH sides", (raw, expected) => {
    expect(phoneMatchKey(raw)).toBe(expected);
    expect(sqlSideEquivalent(raw)).toBe(expected);
  });

  it("★ the exact prod pair that never matched now does", () => {
    // An estimate stored E.164 and an invoice stored formatted, same human.
    expect(phoneMatchKey("+12165559999")).toBe(sqlSideEquivalent("(216) 555-9999"));
  });

  it("refuses to identify anyone below ten digits rather than guessing", () => {
    // Prod holds an 8- and a 9-digit row; matching those would be a guess, and a
    // wrong match marks a genuinely declined estimate as converted.
    expect(phoneMatchKey("12345678")).toBeNull();
    expect(phoneMatchKey("123456789")).toBeNull();
    expect(phoneMatchKey("")).toBeNull();
    expect(phoneMatchKey(null)).toBeNull();
    expect(phoneMatchKey(undefined)).toBeNull();
  });

  it("the SQL twin normalises the COLUMN, so the comparison is key-to-key", () => {
    // Guards against someone re-introducing a raw-column comparison: the SQL
    // must wrap the column, not be compared against it verbatim.
    const rendered = PHONE_MATCH_KEY_SQL("customerPhone");
    expect(rendered).toContain("REGEXP_REPLACE");
    expect(rendered).toContain("customerPhone");
    expect(rendered).toContain("10");
  });

  it("distinct people still do NOT collide", () => {
    // The false-positive half: a matcher that over-matches marks declined work
    // as converted and silently removes real recovery opportunities.
    expect(phoneMatchKey("+12165559999")).not.toBe(phoneMatchKey("+12165559998"));
    expect(phoneMatchKey("(216) 555-1111")).not.toBe(phoneMatchKey("(216) 555-2222"));
  });
});
