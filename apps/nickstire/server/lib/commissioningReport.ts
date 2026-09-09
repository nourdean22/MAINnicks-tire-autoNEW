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
  ENTERING: ["FIRST_SEEN", "ENTERED_ZONE", "ARRIVAL_CANDIDATE"],
  INSIDE_LOT: ["ARRIVAL_CANDIDATE", "CONFIRMED_ARRIVAL"],
  IN_BAY: ["IN_SERVICE"],
  DEPARTED: ["DEPARTING", "LEFT", "PASS_THROUGH"],
};

/**
 * States whose timestamp is FIRST DETECTION, not the moment being witnessed.
 *
 * `vehicle_visits.arrivedAt` comes from the emission's `frigate_start_time`, which
 * `VisionPipeline` fills with the track's `born_ts` -- when the vehicle was first DETECTED,
 * which on an open forecourt is while it is still approaching down the street. The
 * operator's "Entering" tap is the driveway CROSSING. Those are genuinely different
 * instants, and a car visible for ten seconds before it turns in would fail a 3-second
 * tolerance while the pipeline was working perfectly (Codex P1 on #2255).
 *
 * Rather than pretend, the derivation names it FIRST_SEEN and it is judged against
 * `firstSeenToleranceMs` -- wide enough to absorb an approach, tight enough that a
 * detection minutes adrift is still caught. The narrow fix is to persist the crossing
 * instant itself; until an emission-level table exists, this is the honest reading.
 */
const FIRST_DETECTION_STATES = new Set(["FIRST_SEEN"]);

/** Taps whose machine counterpart is REQUIRED for a PASS. */
const REQUIRED: readonly TruthEventName[] = ["ENTERING", "DEPARTED"];

/** Machine states that assert a vehicle ARRIVED — the ones that must never be invented. */
const ARRIVAL_STATES = new Set(["FIRST_SEEN", "ENTERED_ZONE", "ARRIVAL_CANDIDATE", "CONFIRMED_ARRIVAL"]);

export interface HumanEvent {
  event: string;
  /** Epoch milliseconds from the phone's WALL clock, corrected by the measured offset. */
  atMs: number;
  /**
   * The same instant reconstructed as `run start + monotonic offset`, when the phone sent
   * one. PREFERRED over `atMs`, and that preference is the whole reason the client captures
   * two clocks: Android can step its wall clock mid-run (an NTP correction, a timezone
   * change), and every tap after the step would carry the jump. A monotonic timer cannot
   * step, so this survives exactly the case `atMs` cannot (Codex P2 on #2255).
   */
  monoAtMs?: number | null;
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
  /** Tolerance for FIRST_SEEN, which precedes the witnessed moment by the approach. Default 30000 ms. */
  firstSeenToleranceMs?: number;
  /** A wall/monotonic disagreement beyond this means the wall clock stepped. Default 2000 ms. */
  clockStepToleranceMs?: number;
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
  const firstSeenToleranceMs = options.firstSeenToleranceMs ?? 30_000;
  const clockStepToleranceMs = options.clockStepToleranceMs ?? 2_000;
  const minClockSamples = options.minClockSamples ?? 3;
  const maxRttMs = options.maxRttMs ?? 1500;

  const findings: string[] = [];

  // Prefer the monotonic reconstruction wherever the phone sent one, and DISCLOSE any
  // disagreement rather than silently picking a winner: a large gap is itself the useful
  // finding, because it means the wall clock stepped during the run and any conclusion
  // drawn from wall time alone would have been wrong.
  const effective = human.map((h) => ({
    ...h,
    atMs: h.monoAtMs ?? h.atMs,
    driftMs: h.monoAtMs === null || h.monoAtMs === undefined ? null : h.monoAtMs - h.atMs,
  }));
  const stepped = effective.filter((h) => h.driftMs !== null && Math.abs(h.driftMs) > clockStepToleranceMs);
  if (stepped.length) {
    const worst = Math.max(...stepped.map((h) => Math.abs(h.driftMs as number)));
    findings.push(
      `the phone's wall clock and its monotonic timer disagree by up to ${worst} ms on ` +
      `${stepped.length} tap(s) — the wall clock stepped mid-run. The monotonic reading was ` +
      "used, which is why this is a note rather than a failure",
    );
  }

  const ordered = [...effective].sort((a, b) => a.atMs - b.atMs);
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
  //
  // A REQUIRED TAP THAT WAS NEVER MADE is checked before anything else, because it is a
  // hole in the MEASUREMENT rather than a fault in the machine. `required` used to be
  // computed only for taps that were present, so an omitted mandatory tap vanished from
  // both the numerator and the denominator: a run of OUTSIDE + DEPARTED, with a matching
  // LEFT and no machine arrival at all, scored a clean PASS having established nothing
  // about the entry (Codex P1 on #2255). The required set is a CONSTANT, never derived
  // from what happened to be recorded.
  const seen = new Set(ordered.map((h) => h.event));
  const neverTapped = REQUIRED.filter((r) => !seen.has(r));
  for (const r of neverTapped) {
    findings.push(
      `the ${r} tap was never recorded, so this run cannot establish that measurement ` +
      "at all — it is a hole in the witness, not a fault in the camera",
    );
  }

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

  const toleranceFor = (m: Match): number =>
    m.machine && FIRST_DETECTION_STATES.has(m.machine.state) ? firstSeenToleranceMs : toleranceMs;

  const deltas = matches
    .filter((m) => m.deltaMs !== null)
    .map((m) => Math.abs(m.deltaMs as number));
  const late = matches.filter((m) => m.deltaMs !== null && Math.abs(m.deltaMs) > toleranceFor(m));
  for (const m of late) {
    const t = toleranceFor(m);
    findings.push(
      `${m.human.event} matched ${m.machine?.state} but ${Math.abs(m.deltaMs as number)} ms away ` +
      `(tolerance ${t} ms${t === firstSeenToleranceMs ? ", the wider first-detection window" : ""})`,
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
  } else if (neverTapped.length) {
    // INCONCLUSIVE, not FAIL: the camera may have been perfect. Nobody wrote down what it
    // was supposed to match, so the run proves nothing either way -- and calling that a
    // FAIL would blame the machine for the operator's missing tap.
    verdict = "INCONCLUSIVE";
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
      // The CONSTANT required set, so a missing tap shrinks the numerator and not the
      // denominator -- "1/2" reads as incomplete, where the old "1/1" read as complete.
      totalRequired: REQUIRED.length,
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
 * ⚠ TWO KNOWN AND DELIBERATE LOSSES OF RESOLUTION, both named rather than papered over.
 *
 * 1. `vehicle_visits` is one row per VISIT, not per emission: it keeps the lifecycle
 *    timestamps and the CURRENT state, so the candidate -> confirmed transition the
 *    tracker emitted is not recoverable. Nothing maps to CONFIRMED_ARRIVAL, which is why
 *    INSIDE_LOT is not a REQUIRED tap -- if it were, every correct run would fail on a gap
 *    in the storage model rather than in the pipeline.
 * 2. `arrivedAt` is the track's BIRTH, not the driveway crossing: `VisionPipeline` puts
 *    `born_ts` in the emission's `frigate_start_time` and `ShopMirror` stores that. So it
 *    is emitted here as FIRST_SEEN and judged against the wider `firstSeenToleranceMs`.
 *    Calling it ENTERED_ZONE would have failed a correct pipeline on any car visible for
 *    more than the 3-second tolerance before it turned in.
 *
 * The honest fix for both is an emission-level table; until then a report says what it can
 * prove and no more.
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
  // FIRST_SEEN, not ENTERED_ZONE: this timestamp is the track's birth (first detection),
  // which precedes the driveway crossing by however long the car was visible approaching.
  push("FIRST_SEEN", ms(row.arrivedAt));
  push("IN_SERVICE", ms(row.bayEnteredAt));
  push("LEFT", ms(row.departedAt));
  return out.sort((a, b) => a.atMs - b.atMs);
}
