/**
 * The join that was broken for 425 estimates.
 *
 * Every input below is a REAL SHAPE measured in production 2026-07-20 — not an
 * invented case. The three tables that must join store phones three ways:
 *
 *   alg_estimates.customer_phone   "+12162035831"   E.164     (378 of 425 rows)
 *   customers.phone                "2162035831"     bare 10   (1941 of 1945)
 *   invoices.customerPhone         "(216) 555-9999" formatted (2 rows) and bare 10 (2660)
 *
 * Raw string equality matched 14 of 425. The last-ten-digit key matches 341,
 * with zero fan-out and zero ambiguity.
 */
import { describe, it, expect } from "vitest";
import { phoneMatchKey, samePhone, PHONE_MATCH_MIN_DIGITS } from "./lib/phoneIdentity";

describe("the three production formats collapse to one key", () => {
  it.each([
    ["+12162035831", "E.164 — how alg_estimates stores it"],
    ["2162035831", "bare 10 — how customers stores it"],
    ["12162035831", "11-digit with country code, no plus"],
    ["(216) 203-5831", "formatted — how some invoices store it"],
    ["216-203-5831", "dashed"],
    ["216.203.5831", "dotted"],
    [" +1 (216) 203-5831 ", "padded and fully punctuated"],
  ])("%s (%s) -> 2162035831", (input) => {
    expect(phoneMatchKey(input)).toBe("2162035831");
  });

  it("THE ACTUAL BUG: E.164 and bare-10 are the same person", () => {
    // This single assertion is the 425-row failure.
    expect(samePhone("+12162035831", "2162035831")).toBe(true);
  });

  it("and the formatted invoice form matches both", () => {
    expect(samePhone("(216) 203-5831", "+12162035831")).toBe(true);
    expect(samePhone("(216) 203-5831", "2162035831")).toBe(true);
  });
});

describe("unknown is never a match", () => {
  it.each([null, undefined, "", "   ", "abc", "-", "()"])("%p yields no key", (input) => {
    expect(phoneMatchKey(input as string)).toBeNull();
  });

  it.each([
    ["12345678", "the real 8-digit row in customers"],
    ["123456789", "the real 9-digit row in customers"],
    ["12345", "too short to identify anyone"],
  ])("refuses %s (%s) rather than guessing", (input) => {
    expect(phoneMatchKey(input)).toBeNull();
  });

  it("TWO NULLS ARE NOT A MATCH", () => {
    // smsInstrumentation.ts:34 returns "" for unusable input, so two
    // unidentifiable records compare EQUAL there. An empty string is a value
    // that joins; null is not. This is the reason the return type is null.
    expect(samePhone(null, null)).toBe(false);
    expect(samePhone("", "")).toBe(false);
    expect(samePhone("abc", "xyz")).toBe(false);
    expect(samePhone("12345", "12345")).toBe(false);
  });

  it("rejects all-same-digit test data that IS in production", () => {
    // "1111111111" is a real row in customers. Linking real work to it would
    // invent a customer who appears to have bought everything.
    expect(phoneMatchKey("1111111111")).toBeNull();
    expect(phoneMatchKey("+11111111111")).toBeNull();
    expect(samePhone("1111111111", "1111111111")).toBe(false);
  });
});

describe("it identifies people, it does not dial them", () => {
  it("never returns a leading plus or country code", () => {
    const key = phoneMatchKey("+12162035831");
    expect(key).not.toMatch(/^\+/);
    expect(key).toHaveLength(PHONE_MATCH_MIN_DIGITS);
  });

  it("is exactly ten digits or null — never a partial answer", () => {
    for (const input of ["+12162035831", "2162035831", "(216) 203-5831", "12162035831"]) {
      expect(phoneMatchKey(input)).toMatch(/^\d{10}$/);
    }
  });

  it("is idempotent — a key fed back in is still itself", () => {
    const once = phoneMatchKey("+12162035831");
    expect(phoneMatchKey(once)).toBe(once);
  });

  it("does not confuse two different people who share a suffix pattern", () => {
    expect(samePhone("+12162035831", "+12162035832")).toBe(false);
    expect(samePhone("2162035831", "2162035830")).toBe(false);
  });
});

describe("the estimate-to-customer join, end to end", () => {
  it("links the pair that failed for every one of 425 rows", () => {
    // alg_estimates row                    customers row
    const estimatePhone = "+12162052060";
    const customerPhone = "2162052060";
    expect(samePhone(estimatePhone, customerPhone)).toBe(true);
    // ...and the invoice that proves the estimate converted
    expect(samePhone(estimatePhone, "(216) 205-2060")).toBe(true);
  });
});
