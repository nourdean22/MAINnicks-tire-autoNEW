/**
 * cameraTimeline -- the day as state segments, business-hour coverage, and the two transition
 * rules that give `camera_health_events` its missing writers (audit N2 + N6).
 */
import { describe, expect, it } from "vitest";
import {
  buildCameraTimeline,
  businessHourWindows,
  coverageByBusinessHour,
  derivedStateBeganAtMs,
  derivedTransition,
  reconcileWithLive,
  resumptionTransition,
  retroOutageTransition,
  type HealthEventRow,
} from "./cameraTimeline";
import { HEALTH_THRESHOLDS } from "./cameraHealth";

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

  it("a row before midnight is ignored (the anchor already covers it); a row stamped after now is clamped to now, not dropped", () => {
    // The database clock can run a second ahead of the app's: the newest row is still the
    // latest fact about the camera, so it takes over AT now instead of vanishing (review on #2929).
    const tl = buildCameraTimeline({
      anchor: ev("HEALTHY", h(-2)),
      events: [ev("STALE", h(-1)), ev("PRODUCER_OFFLINE", h(12, 0) + 900)],
      dayStartMs: T0,
      nowMs: h(12),
    });
    expect(tl.segments).toEqual([
      { state: "HEALTHY", fromMs: T0, toMs: h(12), open: false, reason: null },
      { state: "PRODUCER_OFFLINE", fromMs: h(12), toMs: h(12), open: true, reason: null },
    ]);
    expect(tl.current).toEqual({ state: "PRODUCER_OFFLINE", sinceMs: h(12), forSeconds: 0 });
    // The before-midnight row alone changes nothing.
    const only = buildCameraTimeline({ anchor: ev("HEALTHY", h(-2)), events: [ev("STALE", h(-1))], dayStartMs: T0, nowMs: h(12) });
    expect(only.segments).toEqual([{ state: "HEALTHY", fromMs: T0, toMs: h(12), open: true, reason: null }]);
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
    // ...but it is reported APART and excluded from the expected-watch share (review on #2929):
    // the baseline days were dark at the same hours, so the dark morning is not a data gap.
    expect(cov.hours[0]).toMatchObject({ solarMs: 3_600_000, pct: 0, pctExpected: null });
    expect(cov.hours[1]).toMatchObject({ solarMs: 900_000, watchedMs: 2_700_000, pct: 0.75, pctExpected: 1 });
    expect(cov.solarMs).toBe(4_500_000);
    expect(cov.pctExpected).toBe(1);
  });

  it("an UNEXPECTED outage is not excused: it lowers pctExpected exactly as it lowers pct", () => {
    const tl = buildCameraTimeline({
      anchor: ev("HEALTHY", h(-1)),
      events: [ev("PRODUCER_OFFLINE", h(9)), ev("HEALTHY", h(9, 30))],
      dayStartMs: T0,
      nowMs: h(10),
    });
    const cov = coverageByBusinessHour(tl.segments, windows, h(10));
    expect(cov.solarMs).toBe(0);
    expect(cov.pct).toBeCloseTo(90 / 120, 6);
    expect(cov.pctExpected).toBeCloseTo(90 / 120, 6);
  });
});

/**
 * When a READ-derived state began (review on #2929): the 5-minute pass notices a dead producer
 * up to five minutes late, and a timeline row stamped at the tick counted those minutes as
 * watched. The clock that identifies the outage is the last heartbeat, plus the threshold.
 */
describe("derivedStateBeganAtMs", () => {
  const T = HEALTH_THRESHOLDS;
  const received = 1_791_460_000; // epoch seconds of the last heartbeat
  const now = (received + 300) * 1000;

  it("STALE and PRODUCER_OFFLINE begin their threshold after the last heartbeat, never at the tick", () => {
    expect(derivedStateBeganAtMs({ state: "STALE", receivedAtEpoch: received, ageSeconds: 300, stateSinceEpoch: received - 7200, nowMs: now }))
      .toBe((received + T.staleAfterSeconds) * 1000);
    expect(derivedStateBeganAtMs({ state: "PRODUCER_OFFLINE", receivedAtEpoch: received, ageSeconds: 300, stateSinceEpoch: received - 7200, nowMs: now }))
      .toBe((received + T.offlineAfterSeconds) * 1000);
  });

  it("an expected solar outage that is a heartbeat GAP begins like STALE; one the producer itself reports begins at its stateSince", () => {
    expect(derivedStateBeganAtMs({ state: "EXPECTED_SOLAR_OFFLINE", receivedAtEpoch: received, ageSeconds: 300, stateSinceEpoch: received - 7200, nowMs: now }))
      .toBe((received + T.staleAfterSeconds) * 1000);
    // Heartbeats still arriving (age 20 s): the edge is up with no stream, so the producer's own clock applies.
    expect(derivedStateBeganAtMs({ state: "EXPECTED_SOLAR_OFFLINE", receivedAtEpoch: received, ageSeconds: 20, stateSinceEpoch: received - 40, nowMs: now }))
      .toBe((received - 40) * 1000);
  });

  it("every producer-reported state begins at stateSince; no clock at all is null; nothing begins in the future", () => {
    expect(derivedStateBeganAtMs({ state: "HEALTHY", receivedAtEpoch: received, ageSeconds: 10, stateSinceEpoch: received - 3600, nowMs: now })).toBe((received - 3600) * 1000);
    expect(derivedStateBeganAtMs({ state: "CAMERA_OFFLINE", receivedAtEpoch: received, ageSeconds: 10, stateSinceEpoch: null, nowMs: now })).toBeNull();
    expect(derivedStateBeganAtMs({ state: "STALE", receivedAtEpoch: null, ageSeconds: null, stateSinceEpoch: null, nowMs: now })).toBeNull();
    // A heartbeat received "now" is STALE only in 60 s: clamped to now rather than reported ahead of it.
    expect(derivedStateBeganAtMs({ state: "STALE", receivedAtEpoch: received + 300, ageSeconds: 0, stateSinceEpoch: null, nowMs: now })).toBe(now);
  });
});

/**
 * The rows lag the reader (review on #2929): the pass writes a read-derived state up to five
 * minutes after it began, and a camera the pass does not cover never gets one. The reader
 * derives the live state itself and corrects the open segment where the two disagree.
 */
describe("reconcileWithLive", () => {
  const recorded = () =>
    buildCameraTimeline({ anchor: ev("HEALTHY", h(-1)), events: [], dayStartMs: T0, nowMs: h(12) });

  it("cuts the open segment where the live state began and lets the live state run to now", () => {
    const tl = reconcileWithLive(recorded(), { state: "PRODUCER_OFFLINE", sinceMs: h(11, 50), reason: "last heartbeat 600s ago" }, h(12));
    expect(tl.segments.map((s) => [s.state, s.fromMs, s.toMs, s.open])).toEqual([
      ["HEALTHY", T0, h(11, 50), false],
      ["PRODUCER_OFFLINE", h(11, 50), h(12), true],
    ]);
    expect(tl.current).toEqual({ state: "PRODUCER_OFFLINE", sinceMs: h(11, 50), forSeconds: 600 });
    expect(tl.anchorKnown).toBe(true);
    // Which is what keeps a dead producer's last ten minutes out of "watched".
    const cov = coverageByBusinessHour(tl.segments, businessHourWindows(h(8), h(18)), h(12));
    expect(cov.watchedMs).toBe(4 * 3_600_000 - 600_000);
  });

  it("agrees with rows that already say what the reader sees, and never times a camera that never ingested", () => {
    const same = recorded();
    expect(reconcileWithLive(same, { state: "HEALTHY", sinceMs: h(-1), reason: null }, h(12))).toBe(same);
    const never = buildCameraTimeline({ anchor: null, events: [], dayStartMs: T0, nowMs: h(12) });
    expect(reconcileWithLive(never, { state: "NEVER_INGESTED", sinceMs: null, reason: "no heartbeat" }, h(12))).toBe(never);
  });

  it("a live state that began before the open segment cuts at the segment's start; one with no clock takes over at now", () => {
    const early = reconcileWithLive(
      buildCameraTimeline({ anchor: ev("HEALTHY", h(-1)), events: [ev("STALE", h(11))], dayStartMs: T0, nowMs: h(12) }),
      { state: "PRODUCER_OFFLINE", sinceMs: h(10), reason: null },
      h(12),
    );
    expect(early.segments.map((s) => [s.state, s.fromMs, s.toMs])).toEqual([
      ["HEALTHY", T0, h(11)],
      ["PRODUCER_OFFLINE", h(11), h(12)],
    ]);
    expect(early.current).toEqual({ state: "PRODUCER_OFFLINE", sinceMs: h(10), forSeconds: 7200 });
    const noClock = reconcileWithLive(recorded(), { state: "CAMERA_OFFLINE", sinceMs: null, reason: null }, h(12));
    expect(noClock.segments.map((s) => [s.state, s.fromMs, s.toMs, s.open])).toEqual([
      ["HEALTHY", T0, h(12), false],
      ["CAMERA_OFFLINE", h(12), h(12), true],
    ]);
    expect(noClock.current).toEqual({ state: "CAMERA_OFFLINE", sinceMs: h(12), forSeconds: 0 });
  });

  it("an unanchored morning stays UNKNOWN up to the live state's start: unknown is not watched and not an outage", () => {
    const tl = reconcileWithLive(
      buildCameraTimeline({ anchor: null, events: [], dayStartMs: T0, nowMs: h(12) }),
      { state: "PRODUCER_OFFLINE", sinceMs: h(11, 50), reason: null },
      h(12),
    );
    expect(tl.anchorKnown).toBe(false);
    expect(tl.segments.map((s) => s.state)).toEqual(["UNKNOWN", "PRODUCER_OFFLINE"]);
    const cov = coverageByBusinessHour(tl.segments, businessHourWindows(h(8), h(18)), h(12));
    expect(cov.watchedMs).toBe(0);
    expect(cov.unknownMs).toBe(4 * 3_600_000 - 600_000);
  });
});

/**
 * The outage row the ingest writes for a gap the 5-minute pass never saw (review on #2929):
 * a 90-second blackout between two ticks left no row at all, so its minutes counted as watched.
 */
describe("retroOutageTransition (the heartbeat ingest, on resumption)", () => {
  const T = HEALTH_THRESHOLDS;
  const prev = 1_791_460_000;

  it("a gap past the stale threshold but inside the offline one is STALE, stamped 60 s after the last heartbeat", () => {
    expect(retroOutageTransition({ gapSeconds: 90, prevReceivedEpoch: prev, latestToState: "HEALTHY" })).toEqual({
      from: "HEALTHY",
      to: "STALE",
      reason: `no heartbeat for 90 s (recorded at resumption; began ${T.staleAfterSeconds} s after the last one)`,
      atEpoch: prev + T.staleAfterSeconds,
    });
  });

  it("a longer gap is PRODUCER_OFFLINE, stamped 120 s after the last heartbeat", () => {
    const row = retroOutageTransition({ gapSeconds: 1900, prevReceivedEpoch: prev, latestToState: "HEALTHY" });
    expect(row).toMatchObject({ from: "HEALTHY", to: "PRODUCER_OFFLINE", atEpoch: prev + T.offlineAfterSeconds });
    expect(row!.reason).toContain("began 120 s after the last one");
  });

  it("a solar camera that went dark inside its window is recorded as expected, not as a fault", () => {
    const row = retroOutageTransition({
      gapSeconds: 50_000,
      prevReceivedEpoch: prev,
      latestToState: "HEALTHY",
      solarExpectedAt: (ms) => ms === (prev + T.offlineAfterSeconds) * 1000,
    });
    expect(row).toMatchObject({ to: "EXPECTED_SOLAR_OFFLINE", atEpoch: prev + T.offlineAfterSeconds });
    expect(row!.reason).toContain("dark inside the solar window");
    // The sky is asked about the moment the outage BEGAN, not about now.
    const asked: number[] = [];
    retroOutageTransition({ gapSeconds: 50_000, prevReceivedEpoch: prev, latestToState: "HEALTHY", solarExpectedAt: (ms) => (asked.push(ms), false) });
    expect(asked).toEqual([(prev + T.offlineAfterSeconds) * 1000]);
  });

  it("writes nothing when the pass already recorded the outage, when the gap is within cadence, or when no clock places it", () => {
    expect(retroOutageTransition({ gapSeconds: 1900, prevReceivedEpoch: prev, latestToState: "PRODUCER_OFFLINE" })).toBeNull();
    expect(retroOutageTransition({ gapSeconds: 1900, prevReceivedEpoch: prev, latestToState: "STALE" })).toBeNull();
    expect(retroOutageTransition({ gapSeconds: 1900, prevReceivedEpoch: prev, latestToState: "EXPECTED_SOLAR_OFFLINE" })).toBeNull();
    expect(retroOutageTransition({ gapSeconds: T.staleAfterSeconds, prevReceivedEpoch: prev, latestToState: "HEALTHY" })).toBeNull();
    expect(retroOutageTransition({ gapSeconds: null, prevReceivedEpoch: prev, latestToState: "HEALTHY" })).toBeNull();
    expect(retroOutageTransition({ gapSeconds: 1900, prevReceivedEpoch: null, latestToState: "HEALTHY" })).toBeNull();
  });

  it("anchors an empty history (first row ever) and keeps the reason inside VARCHAR(191)", () => {
    const row = retroOutageTransition({ gapSeconds: 123_456_789, prevReceivedEpoch: prev, latestToState: null });
    expect(row).toMatchObject({ from: null, to: "PRODUCER_OFFLINE" });
    expect(row!.reason.length).toBeLessThanOrEqual(191);
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
