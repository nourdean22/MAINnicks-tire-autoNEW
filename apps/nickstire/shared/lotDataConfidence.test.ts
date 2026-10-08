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
