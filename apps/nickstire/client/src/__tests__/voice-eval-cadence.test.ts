/**
 * Evaluation cadence — telling "not scored yet" from "not scored, and stuck".
 *
 * WHY THIS EXISTS. On 2026-09-18 the voice scorecard read `0 v1 · 25 legacy
 * excluded`, every ratio said "not enough denominator", and a permanent amber
 * "Awaiting v1 evaluations" badge sat above it. Nothing was broken. Two
 * cadences make a same-day zero inevitable:
 *
 *   1. `vapi-call-eval` is a TIER 4 job — it ticks once every 24 hours.
 *   2. Inside it a call is deferred until its provider analysis is ready or the
 *      call is already 24h old.
 *
 * So a call taken this afternoon cannot be scored this afternoon, and the panel
 * is pinned to TODAY. A warning guaranteed to be lit is a warning nobody reads,
 * which is precisely how the real stall would have gone unnoticed.
 *
 * These tests pin the boundary that separates the two states. Getting it wrong
 * costs in both directions: too lenient and a stalled pipeline renders calm,
 * too strict and the alarm goes back to being wallpaper.
 *
 * The subject is IMPORTED, not re-implemented. A test that reproduces the logic
 * it checks is a proxy, and a proxy passes while the real code is wrong.
 */
import { describe, expect, it } from "vitest";

import { classifyEvaluationLag } from "../pages/admin/voice/format";

const NOW = Date.UTC(2026, 8, 18, 18, 0, 0);
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const lag = (h: number | null, cadence: number | null = 24) =>
  classifyEvaluationLag({
    oldestUnversionedAt: h == null ? null : hoursAgo(h),
    evalCadenceHours: cadence,
    now: NOW,
  });

describe("a same-day call is PENDING, not an alarm", () => {
  it.each([0, 1, 6, 12, 23])("a call %ih old is pending", (h) => {
    expect(lag(h)).toBe("pending");
  });

  it("still pending at 47h — one cycle to become eligible, one to be scored", () => {
    // The job ticks every 24h AND defers a call until it is 24h old, so the
    // earliest guaranteed scoring is the tick after the call turns 24h. A call
    // at 47h has not yet missed anything it was promised.
    expect(lag(47)).toBe("pending");
  });
});

describe("a call past two cycles is BEHIND, and earns the alarm", () => {
  it.each([48, 72, 120])("a call %ih old is behind", (h) => {
    expect(lag(h)).toBe("behind");
  });

  it("the boundary is exactly 2x the cadence, not approximately", () => {
    expect(lag(47)).toBe("pending");
    expect(lag(48)).toBe("behind");
  });
});

describe("an unreadable state never renders as the reassuring one", () => {
  it("a missing timestamp is BEHIND, not pending", () => {
    // If the server could not say how old the oldest unscored call is, we do
    // not get to conclude everything is fine. Unknown is not zero.
    expect(lag(null)).toBe("behind");
  });

  it("a missing cadence is BEHIND, not pending", () => {
    expect(lag(1, null)).toBe("behind");
  });

  it("both missing is BEHIND", () => {
    expect(lag(null, null)).toBe("behind");
  });

  it("undefined fields (an older server response) are BEHIND", () => {
    // The field is new. A deploy where the client leads the server must not
    // read the missing field as calm.
    expect(classifyEvaluationLag({
      oldestUnversionedAt: undefined,
      evalCadenceHours: undefined,
      now: NOW,
    })).toBe("behind");
  });
});

describe("POSITIVE CONTROL: the classifier actually discriminates", () => {
  it("returns BOTH values across the range, not one constant", () => {
    // Without this, a function hardcoded to "pending" satisfies every pending
    // case above, and one hardcoded to "behind" satisfies every fail-closed
    // case. Neither would be a classifier, and both would look green.
    const seen = new Set([0, 12, 47, 48, 96].map((h) => lag(h)));
    expect([...seen].sort()).toEqual(["behind", "pending"]);
  });

  it("the cadence is LOAD-BEARING — a longer cycle moves the boundary", () => {
    // Pins that the threshold is derived from the cadence the server reports,
    // not from a hardcoded 48. Same call age, opposite verdicts.
    expect(lag(60, 24)).toBe("behind");
    expect(lag(60, 48)).toBe("pending");
  });

  it("defaults `now` to the real clock rather than throwing", () => {
    // The component calls it without `now`. A signature that only worked under
    // an injected clock would pass every test here and break in the browser.
    expect(classifyEvaluationLag({
      oldestUnversionedAt: new Date().toISOString(),
      evalCadenceHours: 24,
    })).toBe("pending");
  });
});
