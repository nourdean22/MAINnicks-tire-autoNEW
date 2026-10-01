/**
 * Pins fit(), the width guard in front of every nhtsa_mfr_warranty_* write (Q-50 phase 2b
 * carry-over from the phase 2a review, where a no-op fit() survived every mutant run).
 * TiDB STRICT rejects an over-width value and loses the row, so the guard must cut to the
 * column width exactly, in characters, and leave anything that fits untouched.
 */
import { describe, expect, it } from "vitest";
import { WIDTH, fit } from "./nhtsaWarrantyParse";

describe("fit()", () => {
  it("cuts an over-width value to exactly the column width", () => {
    expect(fit("abcdef", 3)).toBe("abc");
    expect(fit("x".repeat(WIDTH.components + 40), WIDTH.components)).toHaveLength(WIDTH.components);
    expect(fit("y".repeat(WIDTH.summary + 1), WIDTH.summary)).toHaveLength(WIDTH.summary);
  });

  it("returns a value at or under the width unchanged", () => {
    expect(fit("abc", 3)).toBe("abc");
    expect(fit("ab", 3)).toBe("ab");
    expect(fit("", 3)).toBe("");
  });

  it("never exceeds the width in characters, which is what TiDB's VARCHAR counts", () => {
    // fit() measures UTF-16 units, so a 4-byte character counts as 2 and the cut is conservative.
    const car = "\u{1F697}";
    expect([...fit(car.repeat(10), 8)]).toHaveLength(4);
    expect([...fit("\u00e9".repeat(5), 4)]).toHaveLength(4);
  });
});
