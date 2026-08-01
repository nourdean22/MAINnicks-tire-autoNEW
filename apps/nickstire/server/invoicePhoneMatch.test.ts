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
});
