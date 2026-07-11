/**
 * sanitizeDeadline · regression lock for the past-year deadline bug
 * (2026-07-11). LLM commitment extraction ran without knowing the
 * current date, so "tonight" landed as 2024-03-16 on rows made
 * 2026-06-02 — instantly "700d overdue" in the pulse ticker. The
 * sanitizer drops past or garbled deadlines at every create site.
 */
import { describe, it, expect } from "vitest";
import { sanitizeDeadline } from "@/lib/services/commitments";
import { today } from "@/lib/utils/datetime";

function shiftDays(days: number): string {
  const d = new Date(Date.now() + days * 86400_000);
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

describe("sanitizeDeadline", () => {
  it("keeps today and future deadlines", () => {
    expect(sanitizeDeadline(today())).toBe(today());
    const future = shiftDays(7);
    expect(sanitizeDeadline(future)).toBe(future);
  });

  it("drops past deadlines (hallucinated years)", () => {
    expect(sanitizeDeadline("2024-03-16")).toBeNull();
    expect(sanitizeDeadline(shiftDays(-2))).toBeNull();
  });

  it("drops null/empty/garbled shapes", () => {
    expect(sanitizeDeadline(null)).toBeNull();
    expect(sanitizeDeadline(undefined)).toBeNull();
    expect(sanitizeDeadline("")).toBeNull();
    expect(sanitizeDeadline("tomorrow")).toBeNull();
    expect(sanitizeDeadline("2026/07/15")).toBeNull();
    expect(sanitizeDeadline("null")).toBeNull();
  });

  it("trims whitespace before validating", () => {
    const future = shiftDays(3);
    expect(sanitizeDeadline(` ${future} `)).toBe(future);
  });
});
