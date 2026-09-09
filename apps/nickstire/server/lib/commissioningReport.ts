/**
 * Commissioning report: what a HUMAN witnessed vs what the machine recorded.
 *
 * A controlled drive-in is the only evidence that separates "the pipeline is green" from
 * "the pipeline is right". This turns the two timelines into one comparison and a verdict
 * the operator can act on, and it is deliberately pure: no database, no clock, no network,
 * so the rules below can be argued with in a test instead of in the field at 8pm.
 *
 * THE ASYMMETRY THAT DRIVES EVERY RULE HERE. Missing an arrival is a nuisance -- one car
 * absent from a board. INVENTING one corrupts the operational model: staff act on a car
 * that is not there, and every wait statistic built on it is wrong. So a machine arrival
 * nobody witnessed is always a FAIL, while a slightly late match is a tolerance question.
 */

/** The six taps, in the order a drive-in produces them. */
export const TRUTH_EVENTS = [
  "OUTSIDE",
  "ENTERING",
  "INSIDE_LOT",
  "IN_BAY",
  "EXITING",
  "DEPARTED",
] as const;
export type TruthEventName = (typeof TRUTH_EVENTS)[number];

/**
 * Which machine states could legitimately correspond to each human tap.
 *
 * OUTSIDE and EXITING are deliberately absent: they are context the human gives, not
 * claims the machine makes. A camera has nothing to say about a car that has not entered
 * yet, and treating their absence as a miss would fail every correct run.
 */
const EXPECTED_STATES: Partial<Record<TruthEventName, readonly string[]>> = {
  ENTERING: ["ENTERED_ZONE", "ARRIVAL_CANDIDATE"],
  INSIDE_LOT: ["ARRIVAL_CANDIDATE", "CONFIRMED_ARRIVAL"],
  IN_BAY: ["IN_SERVICE"],
  DEPARTED: ["DEPARTING", "LEFT", "PASS_THROUGH"],
};

/** Taps whose machine counterpart is REQUIRED for a PASS. */
const REQUIRED: readonly TruthEventName[] = ["ENTERING", "DEPARTED"];

/** Machine states that assert a vehicle ARRIVED — the ones that must never be invented. */
const ARRIVAL_STATES = new Set(["ENTERED_ZONE", "ARRIVAL_CANDIDATE", "CONFIRMED_ARRIVAL"]);

export interface HumanEvent {
  event: string;
  /** Epoch milliseconds, already corrected for the run's measured clock offset. */
  atMs: number;
}

export interface MachineEvent {
  state: string;
  atMs: number;
  visitId: string;
}

export interface ClockSync {
  offsetMs: number;
  rttMs: number;
  samples: number;
}

export interface ReportOptions {
  /** A match beyond this is reported as a match AND a finding. Default 3000 ms. */
  toleranceMs?: number;
  /** Below this many clock samples the run is INCONCLUSIVE, not PASS. Default 3. */
  minClockSamples?: number;
  /** An RTT this jittery makes millisecond claims meaningless. Default 1500 ms. */
  maxRttMs?: number;
}

export interface Match {
  human: HumanEvent;
  machine: MachineEvent | null;
  /** machine - human, in ms. Positive means the machine was LATE. */
  deltaMs: number | null;
  required: boolean;
}

export interface CommissioningReport {
  matches: Match[];
  /** Machine events no human tap accounts for. An arrival here is always a failure. */
  unwitnessed: MachineEvent[];
  visitIds: string[];
  verdict: "PASS" | "FAIL" | "INCONCLUSIVE";
  findings: string[];
  stats: {
    matchedRequired: number;
    totalRequired: number;
    maxAbsDeltaMs: number | null;
    medianAbsDeltaMs: number | null;
  };
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/**
 * Compare the two timelines.
 *
 * Matching is NEAREST-IN-TIME among the states that could correspond, and each machine
 * event is consumed at most once. Consuming matters: without it, one machine event could
 * satisfy several human taps and a pipeline that emitted a single state for a whole drive
 * would score a clean pass.
 */
export function buildCommissioningReport(
  human: HumanEvent[],
  machine: MachineEvent[],
  clock: ClockSync | null,
  options: ReportOptions = {},
): CommissioningReport {
  const toleranceMs = options.toleranceMs ?? 3000;
  const minClockSamples = options.minClockSamples ?? 3;
  const maxRttMs = options.maxRttMs ?? 1500;

  const findings: string[] = [];
  const ordered = [...human].sort((a, b) => a.atMs - b.atMs);
  const consumed = new Set<MachineEvent>();
  const matches: Match[] = [];

  for (const h of ordered) {
    const expected = EXPECTED_STATES[h.event as TruthEventName];
    const required = REQUIRED.includes(h.event as TruthEventName);
    if (!expected) {
      // OUTSIDE / EXITING: context, not a claim. Recorded so the timeline reads in full.
      matches.push({ human: h, machine: null, deltaMs: null, required: false });
      continue;
    }
    let best: MachineEvent | null = null;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const m of machine) {
      if (consumed.has(m) || !expected.includes(m.state)) continue;
      const d = Math.abs(m.atMs - h.atMs);
      if (d < bestDelta) {
        best = m;
        bestDelta = d;
      }
    }
    if (best) consumed.add(best);
    matches.push({
      human: h,
      machine: best,
      deltaMs: best ? best.atMs - h.atMs : null,
      required,
    });
  }

  const unwitnessed = machine.filter((m) => !consumed.has(m));
  const visitIds = [...new Set(machine.map((m) => m.visitId))].sort();

  // --- findings, most severe first -----------------------------------------
  const missedRequired = matches.filter((m) => m.required && m.machine === null);
  for (const m of missedRequired) {
    findings.push(`the machine never recorded a counterpart for ${m.human.event}`);
  }

  const inventedArrivals = unwitnessed.filter((m) => ARRIVAL_STATES.has(m.state));
  for (const m of inventedArrivals) {
    findings.push(
      `machine reported ${m.state} for visit ${m.visitId} with no human tap to account for it ` +
      "(an invented arrival is worse than a missed one: staff act on a car that is not there)",
    );
  }

  if (visitIds.length > 1) {
    findings.push(
      `one controlled drive produced ${visitIds.length} visits (${visitIds.join(", ")}) — ` +
      "the track split, so one car would be counted twice",
    );
  }

  const deltas = matches
    .filter((m) => m.deltaMs !== null)
    .map((m) => Math.abs(m.deltaMs as number));
  const late = matches.filter((m) => m.deltaMs !== null && Math.abs(m.deltaMs) > toleranceMs);
  for (const m of late) {
    findings.push(
      `${m.human.event} matched ${m.machine?.state} but ${Math.abs(m.deltaMs as number)} ms away ` +
      `(tolerance ${toleranceMs} ms)`,
    );
  }

  // --- verdict --------------------------------------------------------------
  // INCONCLUSIVE is checked FIRST and is not a soft PASS: a run whose clock was never
  // synced cannot support a millisecond claim, so reporting PASS from it would launder a
  // guess into a receipt.
  let verdict: CommissioningReport["verdict"];
  if (ordered.length === 0) {
    verdict = "INCONCLUSIVE";
    findings.unshift("no human truth events were recorded, so there is nothing to compare against");
  } else if (clock === null || clock.samples < minClockSamples) {
    verdict = "INCONCLUSIVE";
    findings.unshift(
      clock === null
        ? "the phone's clock was never synced against the server, so every delta below is unanchored"
        : `only ${clock.samples} clock sample(s); ${minClockSamples} are needed before a delta means anything`,
    );
  } else if (clock.rttMs > maxRttMs) {
    verdict = "INCONCLUSIVE";
    findings.unshift(
      `round-trip time was ${clock.rttMs} ms; above ${maxRttMs} ms the clock offset is too ` +
      "uncertain for the deltas to be read as machine latency",
    );
  } else if (missedRequired.length || inventedArrivals.length || visitIds.length > 1) {
    verdict = "FAIL";
  } else if (late.length) {
    verdict = "FAIL";
  } else {
    verdict = "PASS";
  }

  return {
    matches,
    unwitnessed,
    visitIds,
    verdict,
    findings,
    stats: {
      matchedRequired: matches.filter((m) => m.required && m.machine !== null).length,
      totalRequired: matches.filter((m) => m.required).length,
      maxAbsDeltaMs: deltas.length ? Math.max(...deltas) : null,
      medianAbsDeltaMs: median(deltas),
    },
  };
}

/**
 * NTP-style offset from round trips, each `{ t0, serverMs, t1 }` in epoch ms.
 *
 * Takes the sample with the LOWEST round-trip time rather than an average: a delayed
 * packet moves the estimate in one direction only, so a mean is biased by exactly the
 * samples that are least trustworthy, while the fastest exchange is the one whose
 * one-way times are most nearly equal.
 */
export function estimateClockOffset(
  samples: Array<{ t0: number; serverMs: number; t1: number }>,
): ClockSync | null {
  if (samples.length === 0) return null;
  let best = samples[0];
  let bestRtt = samples[0].t1 - samples[0].t0;
  for (const s of samples) {
    const rtt = s.t1 - s.t0;
    if (rtt < bestRtt) {
      best = s;
      bestRtt = rtt;
    }
  }
  return {
    offsetMs: Math.round(best.serverMs - (best.t0 + bestRtt / 2)),
    rttMs: Math.round(bestRtt),
    samples: samples.length,
  };
}

/**
 * The machine's timeline, derived from the stored visit row.
 *
 * ⚠ A KNOWN AND DELIBERATE LOSS OF RESOLUTION. `vehicle_visits` is one row per VISIT, not
 * per emission: it keeps the lifecycle timestamps and the CURRENT state, so the
 * candidate -> confirmed transition the tracker actually emitted is not recoverable from
 * it. `arrivedAt` therefore maps to ENTERED_ZONE and nothing maps to CONFIRMED_ARRIVAL,
 * which is why INSIDE_LOT is not a REQUIRED tap -- if it were, every correct run would
 * fail on a gap in the storage model rather than a gap in the pipeline.
 *
 * The honest fix, when it matters, is an emission-level table; until then a report says
 * what it can prove and no more.
 */
export function machineEventsFromVisit(row: {
  visitId: string;
  arrivedAt: Date | string | null;
  bayEnteredAt: Date | string | null;
  departedAt: Date | string | null;
}): MachineEvent[] {
  const ms = (v: Date | string | null): number | null => {
    if (!v) return null;
    const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
    return Number.isNaN(t) ? null : t;
  };
  const out: MachineEvent[] = [];
  const push = (state: string, at: number | null) => {
    if (at !== null) out.push({ state, atMs: at, visitId: row.visitId });
  };
  push("ENTERED_ZONE", ms(row.arrivedAt));
  push("IN_SERVICE", ms(row.bayEnteredAt));
  push("LEFT", ms(row.departedAt));
  return out.sort((a, b) => a.atMs - b.atMs);
}
