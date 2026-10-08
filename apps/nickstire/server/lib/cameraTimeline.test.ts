/**
 * cameraTimeline -- the day as state segments, business-hour coverage, and the two transition
 * rules that give `camera_health_events` its missing writers (audit N2 + N6).
 */
import { describe, expect, it } from "vitest";
import {
  buildCameraTimeline,
  businessHourWindows,
  coverageByBusinessHour,
  derivedTransition,
  resumptionTransition,
  type HealthEventRow,
} from "./cameraTimeline";

const T0 = Date.UTC(2026, 9, 8, 4, 0); // 2026-10-08 00:00 EDT, local midnight
const h = (hours: number, minutes = 0) => T0 + hours * 3_600_000 + minutes * 60_000;
const ev = (toState: string, atMs: number, reason: string | null = null): HealthEventRow => ({ toState, fromState: null, reason, atMs });

describe("buildCameraTimeline", () => {
  it("anchors the day on the last row before it, splits on each change, and leaves the last segment open", () => {
    const tl = buildCameraTimeline({
      anchor: ev("EXPECTED_SOLAR_OFFLINE", h(-4, -35), "dark from civil dusk"),
      events: [ev("HEALTHY", h(8, 51), "producer resumed"), ev("PRODUCER_OFFLINE", h(11, 10), "no heartbeat")],
      dayStartMs: T0,
      nowMs: h(12),
    });
    expect(tl.anchorKnown).toBe(true);
    expect(tl.segments.map((s) => [s.state, s.fromMs, s.toMs, s.open])).toEqual([
      ["EXPECTED_SOLAR_OFFLINE", T0, h(8, 51), false],
      ["HEALTHY", h(8, 51), h(11, 10), false],
      ["PRODUCER_OFFLINE", h(11, 10), h(12), true],
    ]);
    expect(tl.current).toEqual({ state: "PRODUCER_OFFLINE", sinceMs: h(11, 10), forSeconds: 50 * 60 });
  });

  it("an anchored day with no events is one open segment whose `since` predates the day", () => {
    const tl = buildCameraTimeline({ anchor: ev("HEALTHY", h(-30)), events: [], dayStartMs: T0, nowMs: h(9) });
    expect(tl.segments).toHaveLength(1);
    expect(tl.segments[0]).toMatchObject({ state: "HEALTHY", fromMs: T0, toMs: h(9), open: true });
    expect(tl.current).toEqual({ state: "HEALTHY", sinceMs: h(-30), forSeconds: 39 * 3600 });
  });

  it("no anchor and no events is UNKNOWN all day, with nothing current: not a steady camera", () => {
    const tl = buildCameraTimeline({ anchor: null, events: [], dayStartMs: T0, nowMs: h(9) });
    expect(tl.anchorKnown).toBe(false);
    expect(tl.segments).toEqual([{ state: "UNKNOWN", fromMs: T0, toMs: h(9), open: true, reason: null }]);
    expect(tl.current).toBeNull();
  });

  it("no anchor but events: the morning is UNKNOWN until the first row, then known", () => {
    const tl = buildCameraTimeline({ anchor: null, events: [ev("HEALTHY", h(8, 30))], dayStartMs: T0, nowMs: h(9) });
    expect(tl.segments.map((s) => s.state)).toEqual(["UNKNOWN", "HEALTHY"]);
    expect(tl.current).toEqual({ state: "HEALTHY", sinceMs: h(8, 30), forSeconds: 1800 });
  });

  it("a duplicate transition (two writers racing) and an out-of-order row collapse into one segment each", () => {
    const tl = buildCameraTimeline({
      anchor: ev("HEALTHY", h(-1)),
      events: [ev("HEALTHY", h(9, 1), "ingest: resumed"), ev("PRODUCER_OFFLINE", h(8, 50)), ev("HEALTHY", h(9), "5-minute pass")],
      dayStartMs: T0,
      nowMs: h(10),
    });
    expect(tl.segments.map((s) => [s.state, s.fromMs])).toEqual([
      ["HEALTHY", T0],
      ["PRODUCER_OFFLINE", h(8, 50)],
      ["HEALTHY", h(9)],
    ]);
    expect(tl.current?.sinceMs).toBe(h(9));
  });

  it("rows outside the day (before midnight, after now) are ignored rather than bending the segments", () => {
    const tl = buildCameraTimeline({
      anchor: ev("HEALTHY", h(-2)),
      events: [ev("STALE", h(-1)), ev("PRODUCER_OFFLINE", h(13))],
      dayStartMs: T0,
      nowMs: h(12),
    });
    expect(tl.segments).toEqual([{ state: "HEALTHY", fromMs: T0, toMs: h(12), open: true, reason: null }]);
  });
});

describe("coverageByBusinessHour", () => {
  const windows = businessHourWindows(h(8), h(18));

  it("cuts open-to-close into whole hours, the last one shorter when the hours do not divide", () => {
    expect(windows).toHaveLength(10);
    expect(businessHourWindows(h(9), h(16, 30)).at(-1)).toEqual({ startMs: h(16), endMs: h(16, 30) });
  });

  it("counts only HEALTHY as watched, reports UNKNOWN apart, and clips the current hour at now", () => {
    const tl = buildCameraTimeline({
      anchor: null,
      events: [ev("HEALTHY", h(8, 30)), ev("PRODUCER_OFFLINE", h(9, 45)), ev("HEALTHY", h(10))],
      dayStartMs: T0,
      nowMs: h(10, 30),
    });
    const cov = coverageByBusinessHour(tl.segments, windows, h(10, 30));
    // 08:00-09:00: unknown 30 min, watched 30 min.
    expect(cov.hours[0]).toMatchObject({ elapsedMs: 3_600_000, watchedMs: 1_800_000, unknownMs: 1_800_000, pct: 0.5 });
    // 09:00-10:00: watched 45, offline 15.
    expect(cov.hours[1]).toMatchObject({ watchedMs: 2_700_000, unknownMs: 0, pct: 0.75 });
    // 10:00-11:00: 30 min elapsed, all watched.
    expect(cov.hours[2]).toMatchObject({ elapsedMs: 1_800_000, watchedMs: 1_800_000, pct: 1 });
    // 11:00 onward has not happened.
    expect(cov.hours[3]).toMatchObject({ elapsedMs: 0, watchedMs: 0, pct: null });
    expect(cov.elapsedMs).toBe(2.5 * 3_600_000);
    expect(cov.watchedMs).toBe(1_800_000 + 2_700_000 + 1_800_000);
    expect(cov.pct).toBeCloseTo((30 + 45 + 30) / 150, 6);
  });

  it("before the shop opens nothing has elapsed: pct is null, not 0 and not 100", () => {
    const tl = buildCameraTimeline({ anchor: ev("HEALTHY", h(-1)), events: [], dayStartMs: T0, nowMs: h(7) });
    const cov = coverageByBusinessHour(tl.segments, windows, h(7));
    expect(cov.pct).toBeNull();
    expect(cov.elapsedMs).toBe(0);
  });

  it("EXPECTED_SOLAR_OFFLINE inside business hours is not watched: the counts did not see those cars either", () => {
    const tl = buildCameraTimeline({
      anchor: ev("EXPECTED_SOLAR_OFFLINE", h(-4)),
      events: [ev("HEALTHY", h(9, 15))],
      dayStartMs: T0,
      nowMs: h(10),
    });
    const cov = coverageByBusinessHour(tl.segments, windows, h(10));
    expect(cov.hours[0].watchedMs).toBe(0);
    expect(cov.hours[0].unknownMs).toBe(0);
    expect(cov.pct).toBeCloseTo(45 / 120, 6);
  });
});

describe("derivedTransition (the 5-minute pass)", () => {
  it("writes a row when the derived state differs from the last recorded one", () => {
    expect(derivedTransition("HEALTHY", { state: "PRODUCER_OFFLINE", reason: "no heartbeat for 184 s" })).toEqual({
      from: "HEALTHY",
      to: "PRODUCER_OFFLINE",
      reason: "derived on the 5-minute pass: no heartbeat for 184 s",
    });
  });
  it("writes nothing when the state is unchanged, and never times a camera that never ingested", () => {
    expect(derivedTransition("HEALTHY", { state: "HEALTHY", reason: "all facets ok" })).toBeNull();
    expect(derivedTransition(null, { state: "NEVER_INGESTED", reason: "no row" })).toBeNull();
  });
  it("anchors an empty history with a first derived state", () => {
    expect(derivedTransition(null, { state: "HEALTHY", reason: "ok" })).toMatchObject({ from: null, to: "HEALTHY" });
    expect(derivedTransition(null, { state: "HEALTHY", reason: "ok" })!.reason.startsWith("first derived state")).toBe(true);
  });
  it("keeps the reason inside the VARCHAR(191) column", () => {
    const row = derivedTransition("HEALTHY", { state: "STALE", reason: "x".repeat(400) });
    expect(row!.reason.length).toBeLessThanOrEqual(191);
  });
});

describe("resumptionTransition (the heartbeat ingest)", () => {
  const stale = 60;
  it("after a gap past the stale threshold, a producer resuming over a read-derived state closes that state at the heartbeat", () => {
    expect(resumptionTransition({ gapSeconds: 1900, staleAfterSeconds: stale, latestToState: "PRODUCER_OFFLINE", state: "HEALTHY" })).toEqual({
      from: "PRODUCER_OFFLINE",
      to: "HEALTHY",
      reason: "producer resumed after producer offline (1900 s without a heartbeat)",
    });
    expect(resumptionTransition({ gapSeconds: 50_000, staleAfterSeconds: stale, latestToState: "EXPECTED_SOLAR_OFFLINE", state: "CAMERA_OFFLINE" })?.to).toBe("CAMERA_OFFLINE");
  });
  it("a normal 30 s cadence never reads the event table, whatever the last row says", () => {
    expect(resumptionTransition({ gapSeconds: 31, staleAfterSeconds: stale, latestToState: "PRODUCER_OFFLINE", state: "HEALTHY" })).toBeNull();
    expect(resumptionTransition({ gapSeconds: null, staleAfterSeconds: stale, latestToState: "PRODUCER_OFFLINE", state: "HEALTHY" })).toBeNull();
  });
  it("a gap whose last row is a PRODUCER state is the ingest's own transition branch's business, not a resumption", () => {
    expect(resumptionTransition({ gapSeconds: 900, staleAfterSeconds: stale, latestToState: "HEALTHY", state: "HEALTHY" })).toBeNull();
    expect(resumptionTransition({ gapSeconds: 900, staleAfterSeconds: stale, latestToState: null, state: "HEALTHY" })).toBeNull();
  });
});
