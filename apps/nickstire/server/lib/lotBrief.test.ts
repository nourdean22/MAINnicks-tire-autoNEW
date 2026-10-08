/**
 * lotBrief -- the lot camera's view of one shop day for StateNour's morning brief (camera audit N4).
 * Pins the rules the brief is only as honest as: nothing is compared below the coverage gate, the
 * baseline counts only earlier days that passed the same gate, a day before the outage record was
 * complete is unmeasured (never zero), a long stay is an anomaly only when nothing explains it and
 * the camera watched it end to end, and a quiet day still says one true line.
 */
import { describe, expect, it } from "vitest";
import {
  composeLotBrief,
  coverageForPastDay,
  longDwellAnomalies,
  TIMELINE_COMPLETE_FROM_MS,
  type DwellVisit,
  type LotBriefInput,
} from "./lotBrief";
import type { TimelineSegment } from "./cameraTimeline";

// Thursday 2026-10-15, EDT: the shop day runs 04:00Z to 04:00Z, open 08:00-18:00 ET = 12:00Z-22:00Z.
const H = 3_600_000;
const DAY_START = Date.UTC(2026, 9, 15, 4);
const DAY_END = Date.UTC(2026, 9, 16, 4);
const OPEN = Date.UTC(2026, 9, 15, 12);
const CLOSE = Date.UTC(2026, 9, 15, 22);

const healthyAnchor = { toState: "HEALTHY", fromState: null, reason: null, atMs: DAY_START - 6 * H };

describe("coverageForPastDay", () => {
  it("measures a past day to its end: one STALE hour in ten business hours is 90%", () => {
    const c = coverageForPastDay({
      anchor: healthyAnchor,
      events: [
        { toState: "STALE", fromState: "HEALTHY", reason: "heartbeat stopped", atMs: OPEN + 3 * H },
        { toState: "HEALTHY", fromState: "STALE", reason: "resumed", atMs: OPEN + 4 * H },
      ],
      dayStartMs: DAY_START, dayEndMs: DAY_END, openMs: OPEN, closeMs: CLOSE,
    });
    expect(c.pctExpected).toBeCloseTo(0.9, 6);
    expect(c.unmeasured).toBeNull();
    expect(c.segments.length).toBeGreaterThan(1);
  });

  it("minutes the solar camera was expected dark leave the denominator (audit N3)", () => {
    const c = coverageForPastDay({
      anchor: { toState: "EXPECTED_SOLAR_OFFLINE", fromState: "HEALTHY", reason: "dusk", atMs: DAY_START - 8 * H },
      events: [{ toState: "HEALTHY", fromState: "EXPECTED_SOLAR_OFFLINE", reason: "sun", atMs: OPEN + 2 * H }],
      dayStartMs: DAY_START, dayEndMs: DAY_END, openMs: OPEN, closeMs: CLOSE,
    });
    expect(c.pctExpected).toBe(1);
  });

  it("a day that opened before the outage record was complete is UNMEASURED, not zero and not healthy", () => {
    const open = TIMELINE_COMPLETE_FROM_MS - 4 * H;
    const c = coverageForPastDay({
      anchor: healthyAnchor, events: [], dayStartMs: open - 8 * H, dayEndMs: open + 16 * H, openMs: open, closeMs: open + 10 * H,
    });
    expect(c).toEqual({ pctExpected: null, unmeasured: "the camera's outage record starts 2026-10-08", segments: [] });
  });

  it("a day with no business hours is unmeasured", () => {
    const c = coverageForPastDay({ anchor: healthyAnchor, events: [], dayStartMs: DAY_START, dayEndMs: DAY_END, openMs: null, closeMs: null });
    expect(c.pctExpected).toBeNull();
    expect(c.unmeasured).toBe("the shop had no business hours");
  });
});

const allDayHealthy: TimelineSegment[] = [{ state: "HEALTHY", fromMs: DAY_START, toMs: DAY_END, open: true, reason: null }];

function visit(over: Partial<DwellVisit> & { visitId: string }): DwellVisit {
  return {
    episodeKey: over.visitId,
    arrivedAtMs: OPEN + H,
    departedAtMs: OPEN + H + 270 * 60_000,
    bayEnteredAtMs: null,
    bayExitedAtMs: null,
    marks: [],
    ...over,
  };
}

describe("longDwellAnomalies", () => {
  it("counts a 4h30m stay nobody explains, and not a short one", () => {
    const r = longDwellAnomalies([visit({ visitId: "a" }), visit({ visitId: "b", departedAtMs: OPEN + H + 60 * 60_000 })], allDayHealthy, OPEN, CLOSE);
    expect(r).toEqual({ count: 1, longestMinutes: 270, uncertain: 0 });
  });

  it("a service mark, a bay entry or NOT_A_JOB explains the stay; a mark undone by CLEARED does not", () => {
    const at = OPEN + 2 * H;
    const r = longDwellAnomalies([
      visit({ visitId: "started", marks: [{ mark: "SERVICE_STARTED", markedAtMs: at, note: null }] }),
      visit({ visitId: "staff", marks: [{ mark: "NOT_A_JOB", markedAtMs: at, note: null }] }),
      visit({ visitId: "bay", bayEnteredAtMs: at }),
      visit({
        visitId: "undone",
        marks: [
          { mark: "SERVICE_STARTED", markedAtMs: at, note: null },
          { mark: "CLEARED", markedAtMs: at + 60_000, note: null },
        ],
      }),
    ], allDayHealthy, OPEN, CLOSE);
    expect(r).toEqual({ count: 1, longestMinutes: 270, uncertain: 0 });
  });

  it("a stay the camera missed more than 30 minutes of is uncertain, not an anomaly", () => {
    const segments: TimelineSegment[] = [
      { state: "HEALTHY", fromMs: DAY_START, toMs: OPEN + 3 * H, open: false, reason: null },
      { state: "STALE", fromMs: OPEN + 3 * H, toMs: OPEN + 4 * H, open: false, reason: null },
      { state: "HEALTHY", fromMs: OPEN + 4 * H, toMs: DAY_END, open: true, reason: null },
    ];
    expect(longDwellAnomalies([visit({ visitId: "a" })], segments, OPEN, CLOSE)).toEqual({ count: 0, longestMinutes: null, uncertain: 1 });
  });

  it("a car still there at close is measured to close, not through the night", () => {
    const r = longDwellAnomalies([visit({ visitId: "late", arrivedAtMs: CLOSE - 3 * H, departedAtMs: null })], allDayHealthy, OPEN, CLOSE);
    expect(r).toEqual({ count: 1, longestMinutes: 180, uncertain: 0 });
    const short = longDwellAnomalies([visit({ visitId: "later", arrivedAtMs: CLOSE - 2 * H, departedAtMs: null })], allDayHealthy, OPEN, CLOSE);
    expect(short.count).toBe(0);
  });

  it("two visit rows of one stitched episode are one car", () => {
    const r = longDwellAnomalies([
      visit({ visitId: "a1", episodeKey: "ep" }),
      visit({ visitId: "a2", episodeKey: "ep", departedAtMs: OPEN + H + 300 * 60_000 }),
    ], allDayHealthy, OPEN, CLOSE);
    expect(r).toEqual({ count: 1, longestMinutes: 300, uncertain: 0 });
  });

  // Codex on #2931: the stay counted the closed hours before opening.
  it("only business time counts: a car dropped off before opening starts waiting at opening", () => {
    const r = longDwellAnomalies([
      // 06:00 to 09:00 ET is one business hour, not three.
      visit({ visitId: "early", arrivedAtMs: OPEN - 2 * H, departedAtMs: OPEN + H }),
      // 06:00 to 11:30 ET is three and a half business hours, reported as such, not five and a half.
      visit({ visitId: "early-long", arrivedAtMs: OPEN - 2 * H, departedAtMs: OPEN + 3.5 * H }),
    ], allDayHealthy, OPEN, CLOSE);
    expect(r).toEqual({ count: 1, longestMinutes: 210, uncertain: 0 });
  });

  // Codex on #2931: service on one member of an episode left the other member counted.
  it("service on any visit of a car explains the car, even on a short visit; NOT_A_JOB on any visit removes it", () => {
    const at = OPEN + H + 10 * 60_000;
    const r = longDwellAnomalies([
      // Marked while it was briefly on the lot, then back for a long wait after its bay.
      visit({ visitId: "m1", episodeKey: "marked", departedAtMs: OPEN + H + 20 * 60_000, marks: [{ mark: "SERVICE_STARTED", markedAtMs: at, note: null }] }),
      visit({ visitId: "m2", episodeKey: "marked", arrivedAtMs: OPEN + 2.5 * H, departedAtMs: OPEN + 6.5 * H }),
      // The camera saw the short visit enter a bay.
      visit({ visitId: "b1", episodeKey: "bayed", departedAtMs: OPEN + H + 20 * 60_000, bayEnteredAtMs: at }),
      visit({ visitId: "b2", episodeKey: "bayed", arrivedAtMs: OPEN + 2.5 * H, departedAtMs: OPEN + 6.5 * H }),
      // A staff car, marked on one visit.
      visit({ visitId: "s1", episodeKey: "staff", departedAtMs: OPEN + H + 20 * 60_000, marks: [{ mark: "NOT_A_JOB", markedAtMs: at, note: null }] }),
      visit({ visitId: "s2", episodeKey: "staff", arrivedAtMs: OPEN + 2.5 * H, departedAtMs: OPEN + 6.5 * H }),
      // CONTROL: nothing recorded on either visit. One car, measured from its first arrival to its last departure.
      visit({ visitId: "u1", episodeKey: "unexplained", departedAtMs: OPEN + H + 20 * 60_000 }),
      visit({ visitId: "u2", episodeKey: "unexplained", arrivedAtMs: OPEN + 2.5 * H, departedAtMs: OPEN + 6.5 * H }),
    ], allDayHealthy, OPEN, CLOSE);
    expect(r).toEqual({ count: 1, longestMinutes: 330, uncertain: 0 });
  });

  it("a CLEARED undoes marks on its own visit only: another visit's service mark still explains the car", () => {
    const at = OPEN + H + 10 * 60_000;
    const r = longDwellAnomalies([
      visit({ visitId: "c1", episodeKey: "ep", departedAtMs: OPEN + H + 20 * 60_000, marks: [{ mark: "SERVICE_STARTED", markedAtMs: at, note: null }] }),
      visit({ visitId: "c2", episodeKey: "ep", arrivedAtMs: OPEN + 2.5 * H, departedAtMs: OPEN + 6.5 * H, marks: [{ mark: "CLEARED", markedAtMs: at + 60_000, note: null }] }),
    ], allDayHealthy, OPEN, CLOSE);
    expect(r).toEqual({ count: 0, longestMinutes: null, uncertain: 0 });
  });
});

const measuredPrior = [
  { date: "2026-10-08", arrivals: 14, pctExpected: 0.95 },
  { date: "2026-10-01", arrivals: 12, pctExpected: 0.9 },
  { date: "2026-09-24", arrivals: 16, pctExpected: 0.85 },
  { date: "2026-09-17", arrivals: 40, pctExpected: 0.5 }, // under the gate: never part of the mean
];

function input(over: Partial<LotBriefInput> = {}): LotBriefInput {
  return {
    date: "2026-10-15",
    weekday: "thursday",
    open: true,
    arrivals: 14,
    passThroughs: 3,
    coverage: { pctExpected: 0.92, unmeasured: null },
    prior: measuredPrior,
    tickets: { count: 11, withheld: null },
    longDwells: { count: 0, longestMinutes: null, uncertain: 0 },
    ...over,
  };
}

describe("composeLotBrief", () => {
  it("a day with nothing material still says ONE true line", () => {
    const b = composeLotBrief(input());
    expect(b.events).toEqual([]);
    expect(b.lines).toEqual(["Thursday: 14 cars came in, in line with recent Thursdays (camera watched 92% of business hours)."]);
    expect(b.baseline).toEqual({ weeksConsidered: 4, weeksCompared: 3, meanArrivals: 14, withheld: null });
  });

  it("traffic against the same weekday: only days that passed the gate make the mean", () => {
    const b = composeLotBrief(input({ arrivals: 21 }));
    expect(b.events.map((e) => e.kind)).toEqual(["traffic_high"]);
    expect(b.lines[0]).toBe("Busier than usual: 21 cars came in Thursday, against about 14 on the last 3 Thursdays.");
    const quiet = composeLotBrief(input({ arrivals: 6, tickets: { count: 5, withheld: null } }));
    expect(quiet.events.map((e) => e.kind)).toEqual(["traffic_low"]);
  });

  it("a difference under 3 cars or 30% is not material", () => {
    expect(composeLotBrief(input({ arrivals: 17 })).events).toEqual([]); // +3 but under 30% of 14
  });

  it("under the coverage gate NOTHING is compared and the count is called a floor", () => {
    const b = composeLotBrief(input({ arrivals: 4, coverage: { pctExpected: 0.62, unmeasured: null }, longDwells: null }));
    expect(b.events.map((e) => e.kind)).toEqual(["coverage_low"]);
    expect(b.lines[0]).toBe("The lot camera watched 62% of Thursday's business hours, so its count of 4 cars is a floor and nothing was compared.");
    expect(b.baseline.meanArrivals).toBeNull();
  });

  it("a baseline of fewer than two measured days is withheld, and the line says how many there were", () => {
    const prior = measuredPrior.map((p, i) => ({ ...p, pctExpected: i === 0 ? 0.95 : null }));
    const b = composeLotBrief(input({ prior }));
    expect(b.events).toEqual([]);
    expect(b.lines).toEqual([
      "Thursday: 14 cars came in (camera watched 92% of business hours); no same-weekday comparison yet, 1 of the last 4 Thursdays was watched enough to compare.",
    ]);
  });

  it("an unmeasured day is said to be unmeasured, never compared and never called quiet", () => {
    const b = composeLotBrief(input({ coverage: { pctExpected: null, unmeasured: "the camera's outage record starts 2026-10-08" }, longDwells: null }));
    expect(b.events).toEqual([]);
    expect(b.lines).toEqual(["Thursday: 14 cars came in; coverage not measured (the camera's outage record starts 2026-10-08), so nothing was compared."]);
  });

  it("few tickets states both numbers; a withheld ticket count never fires it", () => {
    const b = composeLotBrief(input({ tickets: { count: 5, withheld: null } }));
    expect(b.events.map((e) => e.kind)).toEqual(["few_tickets"]);
    expect(b.lines[0]).toBe("Lot traffic with few tickets: 14 cars came in Thursday and 5 tickets are dated Thursday.");
    const unknown = composeLotBrief(input({ tickets: { count: null, withheld: "the invoice mirror last synced before the day closed" } }));
    expect(unknown.events).toEqual([]);
  });

  it("long stays nobody explains, with the longest", () => {
    const b = composeLotBrief(input({ longDwells: { count: 2, longestMinutes: 310, uncertain: 1 } }));
    expect(b.lines).toEqual(["2 cars stayed 3h+ Thursday with no service recorded (longest 5h 10m)."]);
  });

  it("several events come most material first, at most three", () => {
    const b = composeLotBrief(input({ arrivals: 30, tickets: { count: 6, withheld: null }, longDwells: { count: 1, longestMinutes: 200, uncertain: 0 } }));
    expect(b.events.map((e) => e.kind)).toEqual(["traffic_high", "few_tickets", "long_dwells"]);
    expect(b.lines).toHaveLength(3);
  });

  it("a closed day says so and compares nothing", () => {
    const b = composeLotBrief(input({ open: false, arrivals: 2, coverage: { pctExpected: null, unmeasured: "the shop had no business hours" }, tickets: { count: 0, withheld: null } }));
    expect(b.lines).toEqual(["Thursday: the shop was closed; the lot camera recorded 2 cars coming in."]);
    expect(b.baseline.withheld).toBe("the shop was closed");
  });
});
