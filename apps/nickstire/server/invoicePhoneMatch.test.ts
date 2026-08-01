import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { nameKey } from "./services/shopDriverMirror";

/**
 * Locks the ALG name-matching fix (2026-08-01).
 *
 * ShopDriver ticket payloads usually omit the customer phone; shopDriverMirror
 * compensates by matching the ticket's "LAST, FIRST" name to a customer row and
 * copying that customer's phone onto the invoice. That compensation was doing
 * raw string comparison, so it silently missed whenever ALG's casing differed
 * from ours ("WILLIAMS, RORY" vs "Rory Williams") or an imported customer row
 * carried a trailing space ("Erica ", "CHERYL ").
 *
 * Measured against the real 175-invoice backlog: raw comparison recovered 17,
 * trimmed + case-folded recovered 20. The remaining 155 have no customer record
 * to recover from at all and are NOT a defect.
 */
describe("nameKey — ALG customer name matching", () => {
  it("folds the casing ALG actually sends", () => {
    expect(nameKey("RORY")).toBe(nameKey("Rory"));
    expect(nameKey("WILLIAMS")).toBe(nameKey("Williams"));
  });

  it("ignores the trailing spaces present on imported customer rows", () => {
    expect(nameKey("Erica ")).toBe(nameKey("Erica"));
    expect(nameKey("CHERYL  ")).toBe(nameKey("Cheryl"));
  });

  it("treats null/undefined as empty rather than throwing", () => {
    expect(nameKey(null)).toBe("");
    expect(nameKey(undefined)).toBe("");
  });

  it("still distinguishes genuinely different people", () => {
    // 47 Williamses in the customer base, none named Terrence — this must not
    // collapse into a match, or we would write a stranger's phone onto an invoice.
    expect(nameKey("Terrence")).not.toBe(nameKey("Terrel"));
    expect(nameKey("Trrenze")).not.toBe(nameKey("Terrence"));
  });
});

describe("shopDriverMirror wires nameKey into BOTH sides of the match", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "services", "shopDriverMirror.ts"),
    "utf8",
  );

  it("keys the lastName lookup map through nameKey", () => {
    // Building the map with a raw lastName re-breaks matching even if the
    // filter below is correct, so pin the lookup too.
    expect(src).toMatch(/customersByLastName\.get\(nameKey\(lastName\)\)/);
    expect(src).toMatch(/const key = nameKey\(r\.lastName\)/);
  });

  it("compares firstName through nameKey, not raw ===", () => {
    expect(src).toMatch(/nameKey\(c\.firstName\) === nameKey\(firstName\)/);
    expect(src).not.toMatch(/c\.firstName === firstName/);
  });

  it("keeps the exactly-one-candidate rule (never guesses)", () => {
    expect(src).toMatch(/filtered\.length === 1/);
  });

  it("prefetches candidates case-insensitively — nameKey alone cannot fix this", () => {
    // customers.lastName is utf8mb4_bin (case sensitive, NO PAD), so a plain
    // inArray() returns only rows whose casing matches the ticket's. The
    // candidate for "Aiken, David" (stored "AIKEN") would never reach the
    // nameKey filter at all. Measured: with COLLATE the predicate recovers
    // 20/20 known-recoverable invoices, without it 19/20.
    expect(src).toMatch(/COLLATE utf8mb4_unicode_ci IN/);
    expect(src).not.toMatch(/where\(inArray\(customers\.lastName/);
  });
});

describe("orphan-invoices-investigate reports a name count that can be trusted", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "scripts", "orphan-invoices-investigate.ts"),
    "utf8",
  );

  it("matches the LAST, FIRST shape, not only First Last", () => {
    // The original compared CONCAT_WS(' ',firstName,lastName) against
    // customerName. That builds "First Last" and so could never match a
    // "LAST, FIRST" row — 155 of 433 unlinked invoices. It reported 0 linkable
    // by name regardless of the truth, which read like a real finding.
    expect(src).toMatch(/SUBSTRING_INDEX\(i\.customerName, ',', 1\)/);
    expect(src).toMatch(/SUBSTRING_INDEX\(i\.customerName, ',', -1\)/);
  });

  it("escapes the utf8mb4_bin columns so casing does not drop matches", () => {
    expect(src).toMatch(/COLLATE utf8mb4_unicode_ci/);
  });

  it("reports no-match / exactly-one / ambiguous rather than one opaque total", () => {
    expect(src).toMatch(/no_customer_matches/);
    expect(src).toMatch(/exactly_one_SAFE_TO_LINK/);
    expect(src).toMatch(/ambiguous_DO_NOT_GUESS/);
  });
});
