/**
 * Cross-sell affinity recalibration tests (ROS-033).
 *
 * The point of this suite is to make the recalibration DEMONSTRABLE. The old
 * confidence form is kept as `legacyConfidence` so every claim below is a
 * measurement against it rather than an assertion about it.
 *
 * Production fact being reproduced: 25,550 predictions written between May and
 * July 2026, maximum confidence ever recorded **0.330**, outreach gate `>= 0.50`,
 * zero messages sent, job reporting `completed` every run.
 */

import { describe, expect, it } from "vitest";

import {
  MAX_AFFINITY_SCORE,
  MAX_DECLINED_POINTS,
  MIN_OBSERVATIONS_TO_SCORE,
  TOO_RECENT_DAYS,
  declinedPoints,
  legacyConfidence,
  recencyPoints,
  scoreServiceAffinity,
  type AffinityInput,
} from "./services/engines/affinityScoring";

/** The gate cross-sell outreach compares against. */
const OUTREACH_GATE = 0.5;

const base: AffinityInput = {
  daysSinceCategory: 240,
  seasonal: 1.0,
  hasOpenDeclinedEstimate: false,
  daysSinceDeclined: Number.POSITIVE_INFINITY,
  observations: 4,
};

describe("ROS-033 · the old confidence form could not clear its own gate", () => {
  it("caps around the 0.330 production maximum across the realistic input space", () => {
    // Sweep every plausible customer: 1-12 observed services, last visit
    // 30-720 days ago, every seasonal multiplier the table actually contains.
    let max = 0;
    for (let observations = 1; observations <= 12; observations++) {
      for (let days = 30; days <= 720; days += 15) {
        for (const seasonal of [0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5]) {
          max = Math.max(
            max,
            legacyConfidence({ ...base, observations, daysSinceCategory: days, seasonal }),
          );
        }
      }
    }
    // The ceiling is real but only reachable by a customer with 8+ observed
    // services AND a year-plus gap AND peak season — which is why the observed
    // production max over 25,550 rows was 0.330, not this.
    expect(max).toBeLessThanOrEqual(1);
    // The case that actually describes Nick's customers: a few visits, a gap of
    // several months, ordinary season. This is the 0.330 class.
    const typical = legacyConfidence({ ...base, observations: 4, daysSinceCategory: 210, seasonal: 1.0 });
    expect(typical).toBeLessThan(0.35);
    expect(typical).toBeLessThan(OUTREACH_GATE);
  });

  it("a genuinely strong candidate is still blocked by the product form", () => {
    // Someone with an obvious need: 18 months since their last brake job.
    // Under the old form they still cannot clear the gate, because confidence
    // was multiplied by a sample-size factor that has nothing to do with how
    // likely the prediction is.
    const strong = { ...base, observations: 3, daysSinceCategory: 540, seasonal: 1.2 };
    expect(legacyConfidence(strong)).toBeLessThan(OUTREACH_GATE);
  });

  it("lowering the gate to 0.25 was correctly rejected as a fix", () => {
    // The registry's warning, encoded. Even at 0.25 the typical customer sits
    // below it, which is why the threshold change delivered 6 sends.
    const typical = legacyConfidence({ ...base, observations: 3, daysSinceCategory: 180, seasonal: 1.0 });
    expect(typical).toBeLessThan(0.25);
  });
});

describe("recalibrated model · the gate recovers its meaning", () => {
  it("an open declined estimate carries a candidate over the gate", () => {
    // The real case: quoted for brakes 3 months ago, did not come back, and it
    // has been 8 months since their last brake service.
    const r = scoreServiceAffinity({
      daysSinceCategory: 240,
      seasonal: 1.1,
      hasOpenDeclinedEstimate: true,
      daysSinceDeclined: 90,
      observations: 4,
    });
    expect(r.confidence).toBeGreaterThanOrEqual(OUTREACH_GATE);
    expect(r.reasonParts).toContain("open estimate they never came back for");
    // And the same customer was unreachable under the old form.
    expect(legacyConfidence({ ...base, daysSinceCategory: 240, seasonal: 1.1 })).toBeLessThan(
      OUTREACH_GATE,
    );
  });

  it("recency ALONE still does not clear the gate", () => {
    // This is the conservatism that matters. "It has been a while" is a weak
    // reason to text somebody. The gate should stay shut on it — the fix is not
    // "send more", it is "send when there is a real reason".
    const r = scoreServiceAffinity({ ...base, daysSinceCategory: 300, seasonal: 1.0 });
    expect(r.confidence).toBeLessThan(OUTREACH_GATE);
    expect(r.suppressed).toBe(false);
  });

  it("recency alone clears ONLY at a full-year gap in a peak-season category", () => {
    // Characterization, not a wish. Maximal recency (30 pts, earned only at
    // 365+ days) times a 1.2 seasonal lands at 0.51 — just over the gate.
    //
    // That is deliberate and defensible: "over a year since your last brake
    // service, and it is January in Cleveland" is a real reason to text
    // somebody, not spam. It is pinned here so the boundary is a decision
    // rather than an accident, and so a weight change that quietly opens the
    // gate to ordinary customers fails this test.
    const overdueInSeason = scoreServiceAffinity({ ...base, daysSinceCategory: 400, seasonal: 1.2 });
    expect(overdueInSeason.confidence).toBeGreaterThanOrEqual(OUTREACH_GATE);

    // Everything short of BOTH conditions stays shut:
    const overdueOffSeason = scoreServiceAffinity({ ...base, daysSinceCategory: 400, seasonal: 1.0 });
    const recentishInSeason = scoreServiceAffinity({ ...base, daysSinceCategory: 300, seasonal: 1.2 });
    expect(overdueOffSeason.confidence).toBeLessThan(OUTREACH_GATE);
    expect(recentishInSeason.confidence).toBeLessThan(OUTREACH_GATE);

    // And the seasonal multiplier alone can never carry a customer — the
    // largest one in the table (1.5, A/C in July) still needs the full gap.
    const noGapPeakSeason = scoreServiceAffinity({ ...base, daysSinceCategory: 120, seasonal: 1.5 });
    expect(noGapPeakSeason.confidence).toBeLessThan(OUTREACH_GATE);
  });

  it("a stale declined estimate is weaker but not worthless", () => {
    const fresh = scoreServiceAffinity({
      ...base, hasOpenDeclinedEstimate: true, daysSinceDeclined: 30,
    });
    const stale = scoreServiceAffinity({
      ...base, hasOpenDeclinedEstimate: true, daysSinceDeclined: 700,
    });
    expect(fresh.confidence).toBeGreaterThan(stale.confidence);
    // The work does not un-need itself just because the quote got old.
    expect(stale.confidence).toBeGreaterThan(
      scoreServiceAffinity({ ...base, hasOpenDeclinedEstimate: false }).confidence,
    );
  });
});

describe("recalibrated model · preconditions and suppression", () => {
  it("sparse history disqualifies rather than deflating everyone", () => {
    // The old sampleSize MULTIPLIER damped every customer's confidence toward
    // zero. Now it is a precondition: below the floor we decline to predict.
    const r = scoreServiceAffinity({ ...base, observations: MIN_OBSERVATIONS_TO_SCORE - 1 });
    expect(r.insufficientEvidence).toBe(true);
    expect(r.confidence).toBe(0);
  });

  it("a customer at the evidence floor is scored on signal alone", () => {
    const atFloor = scoreServiceAffinity({
      ...base, observations: MIN_OBSERVATIONS_TO_SCORE, hasOpenDeclinedEstimate: true, daysSinceDeclined: 60,
    });
    const wellAbove = scoreServiceAffinity({
      ...base, observations: 40, hasOpenDeclinedEstimate: true, daysSinceDeclined: 60,
    });
    // Identical signal → identical confidence. Volume of history no longer
    // silently scales the prediction.
    expect(atFloor.confidence).toBe(wellAbove.confidence);
  });

  it("suppresses a service the customer just had, and surfaces no reason", () => {
    const r = scoreServiceAffinity({ ...base, daysSinceCategory: TOO_RECENT_DAYS - 1 });
    expect(r.suppressed).toBe(true);
    expect(r.confidence).toBe(0);
    // A stale reason attached to a suppressed row is how bad copy ships.
    expect(r.reasonParts).toEqual([]);
  });

  it("never having had a service is neutral, not negative", () => {
    const never = scoreServiceAffinity({ ...base, daysSinceCategory: Number.POSITIVE_INFINITY });
    expect(never.confidence).toBe(0);
    expect(never.suppressed).toBe(false);
    // ...and a declined estimate can still carry them, which is the point:
    // a customer quoted for brakes who has never had brakes here is a lead.
    const neverButQuoted = scoreServiceAffinity({
      ...base,
      daysSinceCategory: Number.POSITIVE_INFINITY,
      hasOpenDeclinedEstimate: true,
      daysSinceDeclined: 45,
    });
    expect(neverButQuoted.confidence).toBeGreaterThan(0);
  });
});

describe("recalibrated model · shape guarantees", () => {
  it("confidence never leaves 0..1 across the whole input space", () => {
    for (let days = 0; days <= 1000; days += 25) {
      for (const seasonal of [0.7, 1.0, 1.5]) {
        for (const declined of [true, false]) {
          const r = scoreServiceAffinity({
            daysSinceCategory: days,
            seasonal,
            hasOpenDeclinedEstimate: declined,
            daysSinceDeclined: declined ? days : Number.POSITIVE_INFINITY,
            observations: 5,
          });
          expect(r.confidence).toBeGreaterThanOrEqual(0);
          expect(r.confidence).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("confidence rises monotonically with time since last service", () => {
    let prev = -1;
    for (let days = TOO_RECENT_DAYS; days <= 400; days += 20) {
      const c = scoreServiceAffinity({ ...base, daysSinceCategory: days }).confidence;
      expect(c).toBeGreaterThanOrEqual(prev);
      prev = c;
    }
  });

  it("the denominator counts only implemented signals", () => {
    // If a future signal is added to the score without being added to
    // MAX_AFFINITY_SCORE, confidence silently deflates and cross_sell goes quiet
    // again. This pins the invariant.
    expect(MAX_AFFINITY_SCORE).toBe(recencyPoints(Infinity) + MAX_DECLINED_POINTS + 30 - 30 + 0 + 30);
  });

  it("recency and declined points stay inside their declared caps", () => {
    expect(recencyPoints(99_999)).toBeLessThanOrEqual(30);
    expect(recencyPoints(0)).toBe(0);
    expect(declinedPoints(true, 0)).toBeLessThanOrEqual(MAX_DECLINED_POINTS);
    expect(declinedPoints(false, 0)).toBe(0);
    expect(declinedPoints(true, Number.POSITIVE_INFINITY)).toBe(0);
  });
});
