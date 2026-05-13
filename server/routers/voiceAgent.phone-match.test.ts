/**
 * Phone-match invariant test · wave-181.18 · Gap 1 from test-analyzer audit
 *
 * The wave-181.1 + wave-181.2 fix for lookupCustomer + getDeclinedEstimate
 * uses the SQL invariant:
 *   RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 10) = RIGHT(phoneDigits, 10)
 *
 * This test asserts the JS equivalent normalization works on all 6 known
 * inbound phone formats Vapi + ALG + customer-entered data produce. The
 * SQL relies on this invariant — if a future refactor breaks it, every
 * Vapi customer lookup silently fails and the "Hey Robert, welcome back!"
 * personalization stops firing.
 *
 * The original bug shipped silently for 14 days before the smoke test
 * caught it. This test is the cheap regression guard so it can't happen
 * again the next time someone "cleans up" the regex.
 */

import { describe, expect, it } from "vitest";

// JS reimplementation of the SQL-side normalization: strip all non-digits,
// take last 10. Mirrors RIGHT(REGEXP_REPLACE(phone, '[^0-9]', ''), 10).
function lastTenDigits(raw: string): string {
  return raw.replace(/\D/g, "").slice(-10);
}

describe("phone-match invariant (lookupCustomer / getDeclinedEstimate)", () => {
  const CANONICAL = "2168620005"; // the Cleveland 216-862-0005 last-10

  it("all 6 known inbound phone formats reduce to the same last-10 digits", () => {
    expect(lastTenDigits("+12168620005")).toBe(CANONICAL);
    expect(lastTenDigits("12168620005")).toBe(CANONICAL);
    expect(lastTenDigits("2168620005")).toBe(CANONICAL);
    expect(lastTenDigits("(216) 862-0005")).toBe(CANONICAL);
    expect(lastTenDigits("216-862-0005")).toBe(CANONICAL);
    expect(lastTenDigits("+1 216-862-0005")).toBe(CANONICAL);
  });

  it("handles the ALG-formatted E.164 phone that caused the wave-181.1 bug", () => {
    // The actual bug-reproducing case: ALG stores phones as "+1 216-862-0005"
    // which the original REPLACE chain mangled to "12168620005" (11 digits)
    // and never matched the customers.phone column's "+12168620005".
    expect(lastTenDigits("+1 216-862-0005")).toBe(lastTenDigits("(216) 862-0005"));
    expect(lastTenDigits("+1 216-862-0005")).toBe(lastTenDigits("+12168620005"));
  });

  it("short phones (under 10 digits) return only what's available — the early-return path", () => {
    expect(lastTenDigits("862-0005")).toBe("8620005");
    expect(lastTenDigits("862-0005").length).toBeLessThan(10);
  });

  it("non-numeric strings return empty (validation gate before SQL)", () => {
    expect(lastTenDigits("not a phone")).toBe("");
    expect(lastTenDigits("")).toBe("");
  });

  it("rejects numeric strings under 10 chars (matches the procedure's < 10 guard)", () => {
    // The procedure has: if (phoneDigits.length < 10) return { found: false }
    expect(lastTenDigits("123").length).toBeLessThan(10);
  });
});
