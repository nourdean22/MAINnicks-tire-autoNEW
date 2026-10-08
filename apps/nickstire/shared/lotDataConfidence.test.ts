import { describe, expect, it } from "vitest";
import { lotDataConfidence, type LotConfidenceHour } from "./lotDataConfidence";

// Mirrors LOT_CONFIDENCE_RULES in lotDataConfidence.ts (drops, minExpected). Restated by
// value on purpose: the rules are not exported (no production consumer reads them), and a
// verdict that moved because a threshold moved should fail HERE, visibly, not be absorbed.
const LOT_CONFIDENCE_DROPS = 5;
const LOT_CONFIDENCE_MIN_EXPECTED = 6;

/** The pro-rata expectation, read back through the public verdict. */
function expectedArrivalsSoFar(hs: LotConfidenceHour[], clock: { hour: number; minute: number }): number | null {
  const arrivals = hs.reduce((n, h) => n + h.arrivals, 0);
  return lotDataConfidence({
    activity: {
      ok: true,
      hours: hs,
      totals: { arrivals, passThroughs: 0, crossings: arrivals, passThroughShare: null },
      history: { priorDaysWithData: 5 },
    },
    sign: { state: "HEALTHY", stateForSeconds: 3600, dropsToday: 0 },
    clock,
  }).expectedSoFar;
}

/** A shop day: ~4 arrivals an hour from 8 to 17, nothing otherwise. */
function hours(todayByHour: Record<number, number> = {}, baselinePerHour: number | null = 4): LotConfidenceHour[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    arrivals: todayByHour[hour] ?? 0,
    passThroughs: 0,
    baselineArrivals: baselinePerHour === null ? null : hour >= 8 && hour < 18 ? baselinePerHour : 0,
  }));
}

function activity(over: {
  today?: Record<number, number>;
  baseline?: number | null;
  priorDays?: number;
  passThroughs?: number;
} = {}) {
  const hs = hours(over.today ?? {}, over.baseline === undefined ? 4 : over.baseline);
  const arrivals = hs.reduce((n, h) => n + h.arrivals, 0);
  const passThroughs = over.passThroughs ?? 0;
  const crossings = arrivals + passThroughs;
  return {
    ok: true as const,
    hours: hs,
    totals: { arrivals, passThroughs, crossings, passThroughShare: crossings === 0 ? null : passThroughs / crossings },
    history: { priorDaysWithData: over.priorDays ?? 5 },
  };
}

const healthySign = { state: "HEALTHY", stateForSeconds: 3600, dropsToday: 0 };
const noon = { hour: 12, minute: 0 };

describe("expectedArrivalsSoFar", () => {
  it("sums whole earlier hours and the current hour pro rata, skipping hours without history", () => {
    // 8,9,10,11 in full (16) + half of 12 (2) = 18.
    expect(expectedArrivalsSoFar(hours(), { hour: 12, minute: 30 })).toBe(18);
    expect(expectedArrivalsSoFar(hours({}, null), { hour: 12, minute: 30 })).toBe(0);
    expect(expectedArrivalsSoFar(hours(), { hour: 7, minute: 59 })).toBe(0);
  });

  it("the LOW ratio is applied at exactly one half: 13 of 28 is LOW, 14 of 28 is not", () => {
    const at = (arrivals: number) =>
      lotDataConfidence({
        activity: {
          ok: true,
          hours: hours({ 9: arrivals }),
          totals: { arrivals, passThroughs: 0, crossings: arrivals, passThroughShare: null },
          history: { priorDaysWithData: 5 },
        },
        sign: { state: "HEALTHY", stateForSeconds: 3600, dropsToday: 0 },
        clock: { hour: 15, minute: 0 },
      }).level;
    expect(at(13)).toBe("LOW");
    expect(at(14)).toBe("OK");
  });
});

describe("lotDataConfidence", () => {
  it("the 2026-10-05 shape -- 4 arrivals by mid-afternoon on a ~40-car baseline -- is LOW, in words", () => {
    const v = lotDataConfidence({ activity: activity({ today: { 9: 2, 11: 2 } }), sign: healthySign, clock: { hour: 15, minute: 0 } });
    expect(v.level).toBe("LOW");
    expect(v.observedArrivals).toBe(4);
    expect(v.expectedSoFar).toBe(28);
    expect(v.headline).toContain("4 arrivals so far vs about 28 usual by now");
  });

  it("a normal morning against the same baseline is OK and says what it compared", () => {
    const v = lotDataConfidence({ activity: activity({ today: { 8: 4, 9: 5, 10: 3, 11: 4 } }), sign: healthySign, clock: noon });
    expect(v.level).toBe("OK");
    expect(v.headline).toContain("16 arrivals so far vs about 16 usual by now");
    expect(v.headline).toContain("sign camera healthy");
  });

  it("a camera that is not HEALTHY makes the counts UNKNOWN, never LOW: not looking is not seeing few", () => {
    const v = lotDataConfidence({
      activity: activity({ today: {} }),
      sign: { state: "CAMERA_OFFLINE", stateForSeconds: 7200, dropsToday: 0 },
      clock: { hour: 15, minute: 0 },
    });
    expect(v.level).toBe("UNKNOWN");
    expect(v.headline).toBe("Sign camera camera offline for 2h: arrivals since then were not observed.");
    expect(v.expectedSoFar).toBeNull();
  });

  it("missing camera health or a failed activity read is UNKNOWN with the failure named", () => {
    expect(lotDataConfidence({ activity: activity(), sign: null, clock: noon }).level).toBe("UNKNOWN");
    const failed = lotDataConfidence({ activity: { ok: false, reason: "vehicle_visits read failed" }, sign: healthySign, clock: noon });
    expect(failed.level).toBe("UNKNOWN");
    expect(failed.reasons).toEqual(["vehicle_visits read failed"]);
  });

  it("fewer than two earlier days is no baseline: UNKNOWN, with the count still shown", () => {
    const v = lotDataConfidence({ activity: activity({ today: { 9: 3 }, priorDays: 1 }), sign: healthySign, clock: noon });
    expect(v.level).toBe("UNKNOWN");
    expect(v.headline).toContain("3 arrivals so far; no baseline yet (1 earlier day reported)");
    expect(v.expectedSoFar).toBeNull();
  });

  it(`early in the day (fewer than ${LOT_CONFIDENCE_MIN_EXPECTED} expected) a ratio is noise: UNKNOWN, not LOW and not OK`, () => {
    const v = lotDataConfidence({ activity: activity({ today: {} }), sign: healthySign, clock: { hour: 9, minute: 15 } });
    expect(v.level).toBe("UNKNOWN");
    expect(v.headline).toContain("too early to compare");
    expect(v.expectedSoFar).toBeCloseTo(5, 5);
  });

  it("mostly drive-bys with enough crossings is LOW even when the arrival pace looks fine", () => {
    const v = lotDataConfidence({
      activity: activity({ today: { 8: 4, 9: 5, 10: 3, 11: 4 }, passThroughs: 20 }),
      sign: healthySign,
      clock: noon,
    });
    expect(v.level).toBe("LOW");
    expect(v.reasons[0]).toContain("20 of 36 crossings today read as drive-bys");
  });

  it(`a sign camera that dropped ${LOT_CONFIDENCE_DROPS}+ times today is LOW: the gaps were not observed`, () => {
    const v = lotDataConfidence({
      activity: activity({ today: { 8: 4, 9: 5, 10: 3, 11: 4 } }),
      sign: { ...healthySign, dropsToday: LOT_CONFIDENCE_DROPS },
      clock: noon,
    });
    expect(v.level).toBe("LOW");
    expect(v.reasons[0]).toContain("dropped 5 times today");
  });

  it("POSITIVE CONTROL: the same inputs with the drops and drive-bys removed are OK", () => {
    const v = lotDataConfidence({ activity: activity({ today: { 8: 4, 9: 5, 10: 3, 11: 4 } }), sign: { ...healthySign, dropsToday: 1 }, clock: noon });
    expect(v.level).toBe("OK");
  });
});

// Mirrors LOT_CONFIDENCE_RULES.minCoverage (audit N2), restated by value like the two above.
const LOT_CONFIDENCE_MIN_COVERAGE = 0.8;

describe("lotDataConfidence -- observation coverage (audit N2)", () => {
  const normalMorning = activity({ today: { 8: 4, 9: 4, 10: 4, 11: 4 } });

  it(`below ${LOT_CONFIDENCE_MIN_COVERAGE * 100}% of business time watched the comparison is withheld: UNKNOWN, with the minutes, never OK`, () => {
    const v = lotDataConfidence({
      activity: normalMorning,
      sign: healthySign,
      clock: noon,
      coverage: { pct: 0.55, watchedMinutes: 132, elapsedMinutes: 240 },
    });
    expect(v.level).toBe("UNKNOWN");
    expect(v.headline).toContain("comparison withheld");
    expect(v.headline).toContain("55%");
    expect(v.reasons.join(" ")).toContain("132 of 240 min");
    expect(v.expectedSoFar).toBeNull();
    expect(v.observedArrivals).toBe(16);
  });

  it("a LOW reason that does not depend on the comparison (drive-bys) survives low coverage as LOW", () => {
    const v = lotDataConfidence({
      activity: activity({ today: { 8: 2, 9: 2 }, passThroughs: 20 }),
      sign: healthySign,
      clock: noon,
      coverage: { pct: 0.4, watchedMinutes: 96, elapsedMinutes: 240 },
    });
    expect(v.level).toBe("LOW");
    expect(v.reasons[0]).toContain("drive-bys");
    expect(v.reasons.join(" ")).toContain("40%");
  });

  it("at or above the floor the expectation is scaled to the share watched, and the reason says so", () => {
    // 16 arrivals by noon against 16 expected: OK unscaled. Watched 85%: expected 13.6, still OK, and named.
    const v = lotDataConfidence({ activity: normalMorning, sign: healthySign, clock: noon, coverage: { pct: 0.85, watchedMinutes: 204, elapsedMinutes: 240 } });
    expect(v.level).toBe("OK");
    expect(v.expectedSoFar).toBeCloseTo(16 * 0.85, 6);
    // The note names the EXPECTED-watch share since the review on #2929 (an older server that
    // sends only `pct` is scaled by the raw share, which is the same number here).
    expect(v.reasons.join(" ")).toContain("scaled to the 85% of expected watch time the sign camera covered");
    // The scale is what keeps a watched-85% morning from reading LOW: 7 seen of 16 is LOW, 7 of 13.6 is OK? No: 7 < 6.8 is false -> OK.
    const seven = lotDataConfidence({ activity: activity({ today: { 8: 2, 9: 2, 10: 2, 11: 1 } }), sign: healthySign, clock: noon, coverage: { pct: 0.85, watchedMinutes: 204, elapsedMinutes: 240 } });
    expect(seven.level).toBe("OK");
    const sevenUnscaled = lotDataConfidence({ activity: activity({ today: { 8: 2, 9: 2, 10: 2, 11: 1 } }), sign: healthySign, clock: noon });
    expect(sevenUnscaled.level).toBe("LOW");
  });

  it("coverage not measured (absent, null, or pct null before open) changes nothing", () => {
    const base = lotDataConfidence({ activity: normalMorning, sign: healthySign, clock: noon });
    expect(lotDataConfidence({ activity: normalMorning, sign: healthySign, clock: noon, coverage: null })).toEqual(base);
    expect(lotDataConfidence({ activity: normalMorning, sign: healthySign, clock: noon, coverage: { pct: null, watchedMinutes: 0, elapsedMinutes: 0 } })).toEqual(base);
  });
});

/**
 * The gate and the scale read the EXPECTED-watch share (review on #2929). The solar sign
 * camera is dark for the first ~1.5 business hours every October day; the baseline days were
 * dark then too, so those minutes are not a data-quality gap and must not withhold the
 * comparison or discount it twice. An UNEXPECTED outage still does both.
 */
describe("lotDataConfidence -- coverage reads the expected-watch share, scaled per hour (review on #2929)", () => {
  const normalMorning = activity({ today: { 8: 4, 9: 4, 10: 4, 11: 4 } });
  /** 08:00-09:40 expected dark (100 min), then watched through noon: raw 58%, expected 100%. */
  const solarMorning = {
    pct: 140 / 240,
    pctExpected: 1,
    watchedMinutes: 140,
    elapsedMinutes: 240,
    solarMinutes: 100,
    hours: [
      { hour: 8, watchedMinutes: 0, elapsedMinutes: 60, solarMinutes: 60 },
      { hour: 9, watchedMinutes: 20, elapsedMinutes: 60, solarMinutes: 40 },
      { hour: 10, watchedMinutes: 60, elapsedMinutes: 60, solarMinutes: 0 },
      { hour: 11, watchedMinutes: 60, elapsedMinutes: 60, solarMinutes: 0 },
    ],
  };

  it("an expected dark morning neither withholds the comparison nor scales it: 58% raw, 100% expected, verdict OK unscaled", () => {
    const v = lotDataConfidence({ activity: normalMorning, sign: healthySign, clock: noon, coverage: solarMorning });
    expect(v.level).toBe("OK");
    expect(v.expectedSoFar).toBe(16);
    expect(v.reasons.join(" ")).not.toContain("scaled");
    expect(v.reasons.join(" ")).not.toContain("withheld");
  });

  it("POSITIVE CONTROL: the same minutes as an UNEXPECTED outage (no solar) are withheld, with the raw share and the minutes", () => {
    const v = lotDataConfidence({
      activity: normalMorning,
      sign: healthySign,
      clock: noon,
      coverage: { ...solarMorning, pctExpected: solarMorning.pct, solarMinutes: 0, hours: solarMorning.hours.map((h) => ({ ...h, solarMinutes: 0 })) },
    });
    expect(v.level).toBe("UNKNOWN");
    expect(v.headline).toContain("watched only 58% of the business time it was expected to");
    expect(v.reasons.join(" ")).toContain("140 of 240 min");
  });

  it("the withheld message names the expected minutes and the dark ones when both apply", () => {
    const v = lotDataConfidence({
      activity: normalMorning,
      sign: healthySign,
      clock: noon,
      // 100 min dark, then only 84 of the remaining 140 watched: 60% of expected.
      coverage: { pct: 84 / 240, pctExpected: 0.6, watchedMinutes: 84, elapsedMinutes: 240, solarMinutes: 100 },
    });
    expect(v.level).toBe("UNKNOWN");
    expect(v.reasons[0]).toContain("watched only 60% of the business time it was expected to so far (84 of 140 min; 100 min expected dark on its battery)");
  });

  it("percentages are FLOORED: 79.6% reads 79%, never '80%' beside a gate at 80%", () => {
    const v = lotDataConfidence({ activity: normalMorning, sign: healthySign, clock: noon, coverage: { pct: 0.796, watchedMinutes: 191, elapsedMinutes: 240 } });
    expect(v.level).toBe("UNKNOWN");
    expect(v.headline).toContain("79%");
    expect(v.headline).not.toContain("80%");
  });

  it("the baseline is scaled PER HOUR: an outage at 10 discounts the 10 o'clock baseline and nothing else", () => {
    // Watched all of 8, 9 and 11; half of 10. Expected = 4 + 4 + 2 + 4 = 14, not 16 x 0.875.
    const hours = [
      { hour: 8, watchedMinutes: 60, elapsedMinutes: 60, solarMinutes: 0 },
      { hour: 9, watchedMinutes: 60, elapsedMinutes: 60, solarMinutes: 0 },
      { hour: 10, watchedMinutes: 30, elapsedMinutes: 60, solarMinutes: 0 },
      { hour: 11, watchedMinutes: 60, elapsedMinutes: 60, solarMinutes: 0 },
    ];
    const v = lotDataConfidence({
      activity: normalMorning,
      sign: healthySign,
      clock: noon,
      coverage: { pct: 210 / 240, pctExpected: 210 / 240, watchedMinutes: 210, elapsedMinutes: 240, solarMinutes: 0, hours },
    });
    expect(v.level).toBe("OK");
    expect(v.expectedSoFar).toBe(14);
    expect(v.reasons.join(" ")).toContain("scaled to the 87% of expected watch time the sign camera covered");
    // Which matters when the arrivals fell in the hours that WERE watched: 7 seen, 14 expected
    // is exactly the LOW boundary; the whole-day scale (16 x 0.875 = 14) agrees here by chance,
    // so move the outage to a baseline-free hour to separate the two rules.
    const earlyOutage = [
      { hour: 7, watchedMinutes: 0, elapsedMinutes: 60, solarMinutes: 0 },
      ...hours.map((h) => ({ ...h, watchedMinutes: 60 })),
    ];
    const seven = lotDataConfidence({
      activity: activity({ today: { 8: 2, 9: 2, 10: 2, 11: 1 } }),
      sign: healthySign,
      clock: noon,
      coverage: { pct: 240 / 300, pctExpected: 240 / 300, watchedMinutes: 240, elapsedMinutes: 300, solarMinutes: 0, hours: earlyOutage },
    });
    // Per hour: the 7 o'clock outage discounts a baseline of 0; expected stays 16 and 7 of 16 is LOW.
    expect(seven.expectedSoFar).toBe(16);
    expect(seven.level).toBe("LOW");
  });

  it("without per-hour cells the whole expectation is scaled by the expected-watch share; an hour the cells do not cover scales by 1", () => {
    const whole = lotDataConfidence({ activity: normalMorning, sign: healthySign, clock: noon, coverage: { pct: 0.5, pctExpected: 0.9, watchedMinutes: 120, elapsedMinutes: 240, solarMinutes: 107 } });
    expect(whole.level).toBe("OK");
    expect(whole.expectedSoFar).toBeCloseTo(16 * 0.9, 6);
    const partial = lotDataConfidence({
      activity: normalMorning,
      sign: healthySign,
      clock: noon,
      coverage: { pct: 0.9, pctExpected: 0.9, watchedMinutes: 216, elapsedMinutes: 240, solarMinutes: 0, hours: [{ hour: 10, watchedMinutes: 36, elapsedMinutes: 60, solarMinutes: 0 }] },
    });
    // Only the 10 o'clock cell is known (60% watched): 4 + 4 + 2.4 + 4.
    expect(partial.expectedSoFar).toBeCloseTo(14.4, 6);
  });

  it("an older server that sends no pctExpected is gated on the raw share, as before", () => {
    const v = lotDataConfidence({ activity: normalMorning, sign: healthySign, clock: noon, coverage: { pct: 0.55, watchedMinutes: 132, elapsedMinutes: 240 } });
    expect(v.level).toBe("UNKNOWN");
    expect(v.headline).toContain("55%");
  });
});
