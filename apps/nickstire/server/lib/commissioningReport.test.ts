import { describe, it, expect } from "vitest";
import {
  EDGE_SETTLE_MS, QUIESCENCE_HEARTBEAT_MAX_AGE_S, TRUTH_EVENTS, assessEdgeQuiescence, buildCommissioningReport, estimateClockOffset, machineEventsFromVisit, type HumanEvent, type MachineEvent,
} from "./commissioningReport";

const T = 1_800_000_000_000;
const GOOD_CLOCK = { offsetMs: 40, rttMs: 90, samples: 5 };

/** A clean drive-in: six taps, and the machine a couple of hundred ms behind each. */
function cleanRun(): { human: HumanEvent[]; machine: MachineEvent[] } {
  return {
    human: [
      { event: "OUTSIDE", atMs: T },
      { event: "ENTERING", atMs: T + 4_000 },
      { event: "INSIDE_LOT", atMs: T + 9_000 },
      { event: "IN_BAY", atMs: T + 40_000 },
      { event: "EXITING", atMs: T + 300_000 },
      { event: "DEPARTED", atMs: T + 310_000 },
    ],
    machine: [
      { state: "FIRST_SEEN", atMs: T + 4_285, visitId: "v-1" },
      { state: "CONFIRMED_ARRIVAL", atMs: T + 9_201, visitId: "v-1" },
      { state: "IN_SERVICE", atMs: T + 40_410, visitId: "v-1" },
      { state: "LEFT", atMs: T + 310_500, visitId: "v-1" },
    ],
  };
}

describe("commissioning report — a clean run", () => {
  it("PASSES and reports the machine's lag as a number", () => {
    const { human, machine } = cleanRun();
    const r = buildCommissioningReport(human, machine, GOOD_CLOCK);
    expect(r.verdict).toBe("PASS");
    expect(r.findings).toEqual([]);
    expect(r.visitIds).toEqual(["v-1"]);
    expect(r.stats.matchedRequired).toBe(r.stats.totalRequired);
    expect(r.stats.maxAbsDeltaMs).toBe(500);
    expect(r.stats.medianAbsDeltaMs).toBeGreaterThan(0);
  });

  it("keeps OUTSIDE and EXITING in the timeline without demanding a machine counterpart", () => {
    // A camera has nothing to say about a car that has not entered yet. Treating their
    // absence as a miss would fail every correct run.
    const { human, machine } = cleanRun();
    const r = buildCommissioningReport(human, machine, GOOD_CLOCK);
    const outside = r.matches.find((m) => m.human.event === "OUTSIDE");
    expect(outside?.machine).toBeNull();
    expect(outside?.required).toBe(false);
    expect(r.matches).toHaveLength(6);
    expect(r.verdict).toBe("PASS");
  });

  it("consumes each machine event at most once", () => {
    // Without consumption, ONE machine event could satisfy several taps, so a pipeline
    // that emitted a single state for a whole drive would score a clean pass.
    const human: HumanEvent[] = [
      { event: "ENTERING", atMs: T },
      { event: "INSIDE_LOT", atMs: T + 1_000 },
      { event: "DEPARTED", atMs: T + 2_000 },
    ];
    const machine: MachineEvent[] = [{ state: "ARRIVAL_CANDIDATE", atMs: T + 500, visitId: "v-1" }];
    const r = buildCommissioningReport(human, machine, GOOD_CLOCK);
    const matched = r.matches.filter((m) => m.machine !== null);
    expect(matched).toHaveLength(1);
    expect(r.verdict).toBe("FAIL");
    expect(r.findings.join(" ")).toContain("never recorded a counterpart for DEPARTED");
  });
});

describe("commissioning report — the failures worth catching", () => {
  it("FAILS when the machine never saw the car arrive", () => {
    const { human } = cleanRun();
    const r = buildCommissioningReport(human, [{ state: "LEFT", atMs: T + 310_100, visitId: "v-1" }], GOOD_CLOCK);
    expect(r.verdict).toBe("FAIL");
    expect(r.findings.join(" ")).toContain("counterpart for ENTERING");
  });

  it("FAILS on an INVENTED arrival, which is the worst outcome, not the mildest", () => {
    // Missing an arrival is a nuisance: one car absent from a board. Inventing one
    // corrupts the model -- staff act on a car that is not there.
    const { human, machine } = cleanRun();
    machine.push({ state: "CONFIRMED_ARRIVAL", atMs: T + 150_000, visitId: "v-ghost" });
    const r = buildCommissioningReport(human, machine, GOOD_CLOCK);
    expect(r.verdict).toBe("FAIL");
    expect(r.unwitnessed.map((m) => m.visitId)).toContain("v-ghost");
    expect(r.findings.join(" ")).toContain("no human tap to account for it");
  });

  it("FAILS when one controlled drive produced two visits", () => {
    const { human, machine } = cleanRun();
    machine[3] = { ...machine[3], visitId: "v-2" };
    const r = buildCommissioningReport(human, machine, GOOD_CLOCK);
    expect(r.verdict).toBe("FAIL");
    expect(r.visitIds).toEqual(["v-1", "v-2"]);
    expect(r.findings.join(" ")).toContain("counted twice");
  });

  it("FAILS a match that is outside tolerance, and says by how much", () => {
    // Uses IN_SERVICE (matched to the IN_BAY tap) rather than the first event: FIRST_SEEN
    // is judged against the wider first-detection window on purpose, so it is the wrong
    // probe for the tight tolerance.
    const { human, machine } = cleanRun();
    machine[2] = { ...machine[2], atMs: T + 40_000 + 9_000 };   // 9 s late into the bay
    const r = buildCommissioningReport(human, machine, GOOD_CLOCK, { toleranceMs: 3000 });
    expect(r.verdict).toBe("FAIL");
    expect(r.findings.join(" ")).toContain("9000 ms away");
  });

  it("a NEGATIVE delta (machine EARLY) is judged on magnitude, not sign", () => {
    // An early machine event is not "better than on time" -- it means the two timelines
    // disagree, and a bay entry before the human saw the car pull in is suspicious.
    const { human, machine } = cleanRun();
    machine[2] = { ...machine[2], atMs: T + 40_000 - 8_000 };
    const r = buildCommissioningReport(human, machine, GOOD_CLOCK, { toleranceMs: 3000 });
    expect(r.verdict).toBe("FAIL");
    const inBay = r.matches.find((m) => m.human.event === "IN_BAY");
    expect(inBay?.deltaMs).toBe(-8_000);
  });
});

describe("commissioning report — INCONCLUSIVE is never a soft pass", () => {
  it("an unsynced clock makes every delta unanchored", () => {
    const { human, machine } = cleanRun();
    const r = buildCommissioningReport(human, machine, null);
    expect(r.verdict).toBe("INCONCLUSIVE");
    expect(r.findings[0]).toContain("never synced");
  });

  it("too few clock samples is INCONCLUSIVE, not PASS", () => {
    const { human, machine } = cleanRun();
    const r = buildCommissioningReport(human, machine, { offsetMs: 40, rttMs: 90, samples: 1 });
    expect(r.verdict).toBe("INCONCLUSIVE");
    expect(r.findings[0]).toContain("clock sample");
  });

  it("a jittery link is INCONCLUSIVE: the deltas cannot be read as machine latency", () => {
    const { human, machine } = cleanRun();
    const r = buildCommissioningReport(human, machine, { offsetMs: 40, rttMs: 4_000, samples: 5 });
    expect(r.verdict).toBe("INCONCLUSIVE");
    expect(r.findings[0]).toContain("round-trip");
  });

  it("no human events at all is INCONCLUSIVE, not a vacuous PASS", () => {
    // The empty-instrument shape: nothing measured must never render as nothing wrong.
    const r = buildCommissioningReport([], cleanRun().machine, GOOD_CLOCK);
    expect(r.verdict).toBe("INCONCLUSIVE");
    expect(r.findings[0]).toContain("nothing to compare");
  });

  it("a BROKEN run is still FAIL, not INCONCLUSIVE, once the clock is good", () => {
    // Precedence check: INCONCLUSIVE outranks FAIL only because an unanchored delta
    // cannot support either verdict -- it must not swallow a real failure.
    const r = buildCommissioningReport(cleanRun().human, [], GOOD_CLOCK);
    expect(r.verdict).toBe("FAIL");
  });
});

describe("clock offset estimation", () => {
  it("uses the FASTEST round trip, not the average", () => {
    // A delayed packet moves the estimate one way only, so a mean is biased by exactly
    // the samples that are least trustworthy.
    const r = estimateClockOffset([
      { t0: 1000, serverMs: 1_050, t1: 1_100 },   // rtt 100, offset +0
      { t0: 2000, serverMs: 2_500, t1: 3_000 },   // rtt 1000, badly delayed
      { t0: 4000, serverMs: 4_020, t1: 4_040 },   // rtt 40  -> the one to trust
    ]);
    expect(r).not.toBeNull();
    expect(r!.rttMs).toBe(40);
    expect(r!.offsetMs).toBe(0);
    expect(r!.samples).toBe(3);
  });

  it("recovers a real offset", () => {
    // Phone is 3 s behind: server stamps t0+1500+3000 for a 3 s-slow phone clock.
    const r = estimateClockOffset([{ t0: 10_000, serverMs: 10_000 + 1_500 + 3_000, t1: 13_000 }]);
    expect(r!.offsetMs).toBe(3_000);
  });

  it("no samples is null, never a fabricated zero offset", () => {
    expect(estimateClockOffset([])).toBeNull();
  });
});

describe("the tap vocabulary", () => {
  it("is the six taps a drive-in produces, in order", () => {
    expect(TRUTH_EVENTS).toEqual([
      "OUTSIDE", "ENTERING", "INSIDE_LOT", "IN_BAY", "EXITING", "DEPARTED",
    ]);
  });
});

describe("deriving the machine timeline from a stored visit row", () => {
  it("maps the lifecycle timestamps and drops the ones never observed", () => {
    const evs = machineEventsFromVisit({
      visitId: "v-1",
      arrivedAt: new Date(T + 4_000),
      bayEnteredAt: null,
      departedAt: new Date(T + 310_000),
    });
    // FIRST_SEEN, not ENTERED_ZONE: this timestamp is the track's BIRTH, which precedes
    // the driveway crossing by however long the car was visible approaching.
    expect(evs.map((e: MachineEvent) => e.state)).toEqual(["FIRST_SEEN", "LEFT"]);
    expect(evs.every((e: MachineEvent) => e.visitId === "v-1")).toBe(true);
    // A never-observed bay entry is ABSENT, not a zero timestamp at the epoch.
    expect(evs.some((e: MachineEvent) => e.state === "IN_SERVICE")).toBe(false);
  });

  it("a run with no bay visit still PASSES: IN_BAY is not required", () => {
    // The storage model cannot express candidate->confirmed, so INSIDE_LOT and IN_BAY are
    // optional by design. If they were required, every correct run would fail on a gap in
    // the schema rather than a gap in the pipeline.
    const human: HumanEvent[] = [
      { event: "ENTERING", atMs: T + 4_000 },
      { event: "INSIDE_LOT", atMs: T + 9_000 },
      { event: "DEPARTED", atMs: T + 310_000 },
    ];
    const machine = machineEventsFromVisit({
      visitId: "v-1", arrivedAt: new Date(T + 4_200), bayEnteredAt: null, departedAt: new Date(T + 310_300),
    });
    const r = buildCommissioningReport(human, machine, GOOD_CLOCK);
    expect(r.verdict).toBe("PASS");
    expect(r.matches.find((m) => m.human.event === "INSIDE_LOT")?.machine).toBeNull();
  });

  it("an unparseable timestamp is dropped, never rendered as 1970", () => {
    const evs = machineEventsFromVisit({
      visitId: "v-1", arrivedAt: "not a date", bayEnteredAt: null, departedAt: null,
    });
    expect(evs).toEqual([]);
  });
});

describe("commissioning report — Codex #2255 findings", () => {
  it("a REQUIRED tap that was never made is INCONCLUSIVE, not a PASS", () => {
    // THE VACUOUS-INSTRUMENT BUG. `required` used to be computed only for taps that were
    // PRESENT, so an omitted mandatory tap vanished from both the numerator and the
    // denominator. This exact run -- OUTSIDE + DEPARTED, a matching LEFT, and no machine
    // arrival at all -- scored a clean PASS having established nothing about the entry.
    const human: HumanEvent[] = [
      { event: "OUTSIDE", atMs: T },
      { event: "DEPARTED", atMs: T + 310_000 },
    ];
    const machine: MachineEvent[] = [{ state: "LEFT", atMs: T + 310_200, visitId: "v-1" }];
    const r = buildCommissioningReport(human, machine, GOOD_CLOCK);
    expect(r.verdict).toBe("INCONCLUSIVE");
    expect(r.findings.join(" ")).toContain("ENTERING tap was never recorded");
    // The denominator is the CONSTANT required set, so this reads as incomplete (1/2)
    // rather than complete (1/1).
    expect(r.stats.totalRequired).toBe(2);
    expect(r.stats.matchedRequired).toBe(1);
  });

  it("INCONCLUSIVE and not FAIL, because the camera may have been perfect", () => {
    // Nobody wrote down what it was supposed to match, so the run proves nothing either
    // way. Calling it FAIL would blame the machine for the operator's missing tap.
    const r = buildCommissioningReport(
      [{ event: "ENTERING", atMs: T }],
      [{ state: "FIRST_SEEN", atMs: T + 100, visitId: "v-1" }],
      GOOD_CLOCK,
    );
    expect(r.verdict).toBe("INCONCLUSIVE");
    expect(r.findings.join(" ")).toContain("hole in the witness");
  });

  it("FIRST_SEEN gets the WIDER tolerance, because it is not the moment witnessed", () => {
    // `arrivedAt` is the track's birth -- on an open forecourt, while the car is still
    // approaching down the street. Judging that against the 3 s crossing tolerance would
    // fail a correct pipeline on any car visible for a few seconds before it turned in.
    const human: HumanEvent[] = [
      { event: "ENTERING", atMs: T + 12_000 },
      { event: "DEPARTED", atMs: T + 310_000 },
    ];
    const machine: MachineEvent[] = [
      { state: "FIRST_SEEN", atMs: T, visitId: "v-1" },          // 12 s before the tap
      { state: "LEFT", atMs: T + 310_200, visitId: "v-1" },
    ];
    const r = buildCommissioningReport(human, machine, GOOD_CLOCK, { toleranceMs: 3000 });
    expect(r.verdict).toBe("PASS");

    // ... but a detection minutes adrift is still caught.
    const adrift = buildCommissioningReport(
      human,
      [{ state: "FIRST_SEEN", atMs: T - 120_000, visitId: "v-1" }, machine[1]],
      GOOD_CLOCK,
      { toleranceMs: 3000, firstSeenToleranceMs: 30_000 },
    );
    expect(adrift.verdict).toBe("FAIL");
    expect(adrift.findings.join(" ")).toContain("first-detection window");
  });

  it("a state that IS the witnessed moment keeps the tight tolerance", () => {
    // The wider window must apply ONLY to first detection, or it would launder a genuinely
    // late departure into a pass.
    const r = buildCommissioningReport(
      [{ event: "ENTERING", atMs: T }, { event: "DEPARTED", atMs: T + 300_000 }],
      [
        { state: "FIRST_SEEN", atMs: T - 5_000, visitId: "v-1" },
        { state: "LEFT", atMs: T + 300_000 + 20_000, visitId: "v-1" },   // 20 s late
      ],
      GOOD_CLOCK,
      { toleranceMs: 3000, firstSeenToleranceMs: 30_000 },
    );
    expect(r.verdict).toBe("FAIL");
    expect(r.findings.join(" ")).toContain("20000 ms away (tolerance 3000 ms)");
  });

  it("an unwitnessed FIRST_SEEN is still an invented arrival", () => {
    const r = buildCommissioningReport(
      [{ event: "ENTERING", atMs: T }, { event: "DEPARTED", atMs: T + 300_000 }],
      [
        { state: "FIRST_SEEN", atMs: T, visitId: "v-1" },
        { state: "LEFT", atMs: T + 300_100, visitId: "v-1" },
        { state: "FIRST_SEEN", atMs: T + 150_000, visitId: "v-ghost" },
      ],
      GOOD_CLOCK,
    );
    expect(r.verdict).toBe("FAIL");
    expect(r.findings.join(" ")).toContain("no human tap to account for it");
  });
});

describe("commissioning report — a wall clock that steps mid-run", () => {
  it("PREFERS the monotonic reading, so a clock jump does not fail a correct pipeline", () => {
    // Android can step its wall clock mid-run (an NTP correction, a timezone change).
    // Every tap after the step carries the jump, so a report reading wall time alone would
    // report enormous latencies for a pipeline that was working perfectly. The client
    // captures a monotonic timer specifically to survive this (Codex P2 on #2255).
    const human: HumanEvent[] = [
      { event: "ENTERING", atMs: T + 4_000, monoAtMs: T + 4_000 },
      // The phone's clock jumped 90 s forward here; the monotonic reading did not.
      { event: "IN_BAY", atMs: T + 40_000 + 90_000, monoAtMs: T + 40_000 },
      { event: "DEPARTED", atMs: T + 310_000 + 90_000, monoAtMs: T + 310_000 },
    ];
    const machine: MachineEvent[] = [
      { state: "FIRST_SEEN", atMs: T + 4_200, visitId: "v-1" },
      { state: "IN_SERVICE", atMs: T + 40_300, visitId: "v-1" },
      { state: "LEFT", atMs: T + 310_400, visitId: "v-1" },
    ];
    const r = buildCommissioningReport(human, machine, GOOD_CLOCK);
    expect(r.verdict).toBe("PASS");
    // The step is DISCLOSED rather than silently absorbed: it is the useful finding.
    expect(r.findings.join(" ")).toContain("wall clock stepped mid-run");
    expect(r.findings.join(" ")).toContain("note rather than a failure");
    expect(r.stats.maxAbsDeltaMs).toBeLessThan(1_000);
  });

  it("falls back to wall time when the phone sent no monotonic reading", () => {
    const { human, machine } = cleanRun();
    const r = buildCommissioningReport(human, machine, GOOD_CLOCK);
    expect(r.verdict).toBe("PASS");
    expect(r.findings.join(" ")).not.toContain("stepped mid-run");
  });

  it("a SMALL wall/monotonic difference is not reported as a step", () => {
    // The two origins differ by the latency of the run-start request -- a couple of
    // hundred milliseconds. Flagging that would cry wolf on every single run.
    const human: HumanEvent[] = [
      { event: "ENTERING", atMs: T + 4_000, monoAtMs: T + 4_180 },
      { event: "DEPARTED", atMs: T + 310_000, monoAtMs: T + 310_180 },
    ];
    const machine: MachineEvent[] = [
      { state: "FIRST_SEEN", atMs: T + 4_200, visitId: "v-1" },
      { state: "LEFT", atMs: T + 310_300, visitId: "v-1" },
    ];
    const r = buildCommissioningReport(human, machine, GOOD_CLOCK);
    expect(r.findings.join(" ")).not.toContain("stepped mid-run");
    expect(r.verdict).toBe("PASS");
  });
});

describe("assessEdgeQuiescence — has the edge finished speaking?", () => {
  const ENDED = 1_700_000_000_000;
  const ok = (over: Partial<Parameters<typeof assessEdgeQuiescence>[0]> = {}) =>
    assessEdgeQuiescence({
      endedMs: ENDED,
      nowMs: ENDED + EDGE_SETTLE_MS + 1_000,
      heartbeatAgeS: 20,
      heartbeatReceivedMs: ENDED + EDGE_SETTLE_MS + 500,
      frameAgeS: 2,
      outboxDepth: 0,
      ...over,
    });

  it("settles when every condition holds", () => {
    expect(ok()).toEqual({ settled: true, reason: null });
  });

  it("REFUSES a heartbeat that predates the grace boundary, even though it postdates End", () => {
    // The exact defect: one second after End the queue is legitimately empty, because
    // the departure has not been generated yet. That reading must not settle the run.
    const r = ok({ heartbeatReceivedMs: ENDED + 1_000, heartbeatAgeS: 20 });
    expect(r.settled).toBe(false);
    expect(r.reason).toContain("predates the departure");
  });

  it("accepts a heartbeat received exactly ON the grace boundary", () => {
    expect(ok({ heartbeatReceivedMs: ENDED + EDGE_SETTLE_MS }).settled).toBe(true);
  });

  it("REFUSES a producer that reports but sees no frames", () => {
    // An empty queue from a dead capture is empty because nothing is produced.
    const r = ok({ frameAgeS: QUIESCENCE_HEARTBEAT_MAX_AGE_S + 1 });
    expect(r.settled).toBe(false);
    expect(r.reason).toContain("nothing is being produced");
  });

  it("REFUSES when frame age is unknown rather than assuming it is fine", () => {
    expect(ok({ frameAgeS: null }).settled).toBe(false);
  });

  it("waits out the settle window before judging anything", () => {
    const r = ok({ nowMs: ENDED + 1_000 });
    expect(r.settled).toBe(false);
    expect(r.reason).toContain("giving it time");
  });

  it("will not settle a run whose end time is unreadable", () => {
    expect(ok({ endedMs: null }).settled).toBe(false);
  });

  it("REFUSES a producer that has gone quiet, and says for how long", () => {
    const r = ok({ heartbeatAgeS: 400 });
    expect(r.settled).toBe(false);
    expect(r.reason).toContain("400s");
  });

  it("REFUSES a producer that has never reported at all", () => {
    const r = ok({ heartbeatAgeS: null, heartbeatReceivedMs: null });
    expect(r.settled).toBe(false);
    expect(r.reason).toContain("no producer heartbeat");
  });

  it("REFUSES while rows are still queued, and says how many", () => {
    const r = ok({ outboxDepth: 3 });
    expect(r.settled).toBe(false);
    expect(r.reason).toContain("3 row(s)");
  });

  it("treats an UNKNOWN queue depth as not-drained, never as empty", () => {
    // A failed read must not render as good news.
    expect(ok({ outboxDepth: null }).settled).toBe(false);
  });
});
