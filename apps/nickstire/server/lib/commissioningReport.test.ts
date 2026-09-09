import { describe, it, expect } from "vitest";
import {
  buildCommissioningReport,
  estimateClockOffset,
  machineEventsFromVisit,
  TRUTH_EVENTS,
  type HumanEvent,
  type MachineEvent,
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
      { state: "ENTERED_ZONE", atMs: T + 4_285, visitId: "v-1" },
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
    const { human, machine } = cleanRun();
    machine[0] = { ...machine[0], atMs: T + 4_000 + 9_000 };   // 9 s late
    const r = buildCommissioningReport(human, machine, GOOD_CLOCK, { toleranceMs: 3000 });
    expect(r.verdict).toBe("FAIL");
    expect(r.findings.join(" ")).toContain("9000 ms away");
  });

  it("a NEGATIVE delta (machine EARLY) is judged on magnitude, not sign", () => {
    // An early machine event is not "better than on time" -- it means the two timelines
    // disagree, and an arrival before the human saw the car enter is suspicious.
    const { human, machine } = cleanRun();
    machine[0] = { ...machine[0], atMs: T + 4_000 - 8_000 };
    const r = buildCommissioningReport(human, machine, GOOD_CLOCK, { toleranceMs: 3000 });
    expect(r.verdict).toBe("FAIL");
    const entering = r.matches.find((m) => m.human.event === "ENTERING");
    expect(entering?.deltaMs).toBe(-8_000);
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
    expect(evs.map((e: MachineEvent) => e.state)).toEqual(["ENTERED_ZONE", "LEFT"]);
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
