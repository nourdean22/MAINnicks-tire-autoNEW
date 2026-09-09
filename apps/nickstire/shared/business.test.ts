/**
 * resolveReviewDisplay() had zero test coverage before this file, despite backing
 * a claim-accuracy-critical number repeated across 30+ pages and the voice-agent
 * script. It previously computed max(floor, live, admin) — a real DECREASE in the
 * live Google count could never surface, because the floor clamped the display
 * back up forever. Fixed 2026-09-09; this suite pins the corrected behavior with
 * the exact regression case (a lower live count) that the old logic got wrong.
 */
import { describe, expect, it } from "vitest";
import { resolveReviewDisplay, BUSINESS } from "./business";

const FLOOR = BUSINESS.reviews.count as number;

describe("resolveReviewDisplay — live data wins outright, never clamped to the floor", () => {
  it("REGRESSION: a live Google count BELOW the floor is shown as-is, not clamped up", () => {
    const r = resolveReviewDisplay({ googleCount: FLOOR - 200 });
    expect(r.numeric).toBe(FLOOR - 200);
    expect(r.provenance).toBe("google");
  });

  it("a live Google count ABOVE the floor is also shown as-is (this direction always worked)", () => {
    const r = resolveReviewDisplay({ googleCount: FLOOR + 50 });
    expect(r.numeric).toBe(FLOOR + 50);
    expect(r.provenance).toBe("google");
  });

  it("falls back to the static floor ONLY when no live or admin data is available", () => {
    const r = resolveReviewDisplay({});
    expect(r.numeric).toBe(FLOOR);
    expect(r.provenance).toBe("business");
  });

  it("an admin override below the live Google count still wins — an explicit human correction is the most authoritative signal", () => {
    const r = resolveReviewDisplay({ googleCount: FLOOR + 100, adminCount: FLOOR - 50 });
    expect(r.numeric).toBe(FLOOR - 50);
    expect(r.provenance).toBe("admin");
  });

  it("negative control: a zero or negative googleCount/adminCount is treated as absent, not as a real value", () => {
    const r = resolveReviewDisplay({ googleCount: 0, adminCount: -5 });
    expect(r.numeric).toBe(FLOOR);
    expect(r.provenance).toBe("business");
  });

  it("negative control: null/undefined inputs behave identically to an empty object", () => {
    const r = resolveReviewDisplay({ googleCount: null, adminCount: undefined });
    expect(r.numeric).toBe(FLOOR);
    expect(r.provenance).toBe("business");
  });

  it("countDisplay always carries a trailing + and thousands separators", () => {
    const r = resolveReviewDisplay({ googleCount: 2345 });
    expect(r.countDisplay).toBe("2,345+");
  });
});
