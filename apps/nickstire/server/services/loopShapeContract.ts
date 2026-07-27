/**
 * LOOP SHAPE CONTRACTS — assert what a job PRODUCED, not that it finished.
 *
 * THE PROBLEM IT SOLVES
 * Every automated loop in this app reports a completion status, and the issue
 * registry is full of loops whose completion status was true and whose output
 * was nothing:
 *
 *   ROS-033  cross_sell: 25,550 predictions, max confidence ever 0.330 against a
 *            >= 0.50 gate. Zero rows have EVER cleared it. The cron runs, reports
 *            `completed`, and sends nothing. It did that from May until someone
 *            went looking in July.
 *   ROS-028  db-backup faked success two ways; ig-autopost dropped its own
 *            `status:"failed"`; and the cron observer's 24h / 2-consecutive-run
 *            streak logic could never alert on a daily job at all.
 *   ROS-029  gsc-pipeline hit its 4-minute cap on 6 of 6 runs for a week.
 *
 * The common shape: the health check asked "did it error?" when the question
 * that mattered was "did the number it exists to move actually move?" A loop
 * that runs perfectly and produces zero is indistinguishable from a loop that is
 * working, unless something declares what working looks like.
 *
 * WHAT THIS IS
 * A declaration, per loop, of the output range a healthy run produces — and a
 * pure classifier over an observed run. It holds no database handle and starts
 * no timer, so it is fully testable and cheap to call from a cron observer, an
 * admin surface, or a test.
 *
 * WHAT IT IS NOT
 * It does not alert, page, or write. Reporting is the caller's job — deliberately,
 * because an alerting side effect buried in a classifier is how you get an
 * observer that cannot be tested.
 *
 * A finding here is evidence, not a verdict: `dormant` on cross_sell is the
 * CORRECT observation, and ROS-033's resolution is explicitly an operator
 * decision (recalibrate, or accept it as dormant and stop calling it live).
 * The contract's job is to make the operator see it in a day, not a quarter.
 */

export type LoopVerdict =
  /** Output inside the declared healthy range. Say nothing. */
  | "in-spec"
  /** Ran, succeeded, produced nothing, and has produced nothing for a while. */
  | "dormant"
  /** Output outside the declared range in either direction. */
  | "anomalous"
  /** The run itself failed. Ordinary failure handling owns this. */
  | "failed"
  /** No run observed in the window the loop's own schedule guarantees. */
  | "missing"
  /** Not enough observations to judge. Never treat as healthy. */
  | "unknown";

export interface LoopShapeContract {
  /** Stable id. Matches the cron job name where one exists. */
  loop: string;
  /** What the loop exists to produce, in the operator's words. */
  produces: string;
  /**
   * Healthy output per run. `min: 0` is legitimate for a loop that genuinely
   * idles (a recovery sweep with nothing to recover), but then `dormantAfterRuns`
   * must be set so a permanent zero is still caught.
   */
  healthyPerRun: { min: number; max?: number };
  /**
   * Consecutive zero-output runs after which the loop is dormant rather than
   * merely quiet. Omit only for a loop where zero is never expected.
   */
  dormantAfterRuns?: number;
  /** Runs expected in a 7-day window, from the loop's schedule. */
  expectedRunsPerWeek: number;
  /** Max acceptable duration. gsc-pipeline hit its cap 6/6 runs for a week. */
  maxDurationMs?: number;
  /** What the operator should look at first. */
  firstCheck: string;
  /** Registry id when this contract was written from a known defect. */
  ros?: string;
}

export interface ObservedRun {
  loop: string;
  /** The count of the thing the loop exists to produce. `null` = not measured. */
  produced: number | null;
  /** Whether the run itself completed without throwing. */
  succeeded: boolean;
  durationMs?: number;
  /** Consecutive prior runs that produced zero, not counting this one. */
  priorZeroRuns?: number;
  /** Runs seen in the trailing 7 days, including this one. */
  runsInWindow?: number;
}

export interface LoopFinding {
  loop: string;
  verdict: LoopVerdict;
  /** One line an operator can act on. */
  summary: string;
  firstCheck: string;
  ros?: string;
  /** True when the caller should surface this. `in-spec` runs stay silent. */
  actionable: boolean;
}

/**
 * The declared shape of every loop whose silence has already cost something.
 *
 * Seeded from verified production findings rather than guesses — a contract
 * invented from an assumption is worse than none, because it manufactures
 * alerts nobody trusts and then everybody mutes.
 */
export const LOOP_CONTRACTS: readonly LoopShapeContract[] = Object.freeze([
  {
    loop: "cross_sell",
    produces: "cross-sell messages sent to eligible customers",
    healthyPerRun: { min: 1 },
    dormantAfterRuns: 3,
    expectedRunsPerWeek: 7,
    firstCheck:
      "Compare MAX(confidence) in the predictions table against the eligibility gate. In July 2026 the max ever recorded was 0.330 against a >= 0.50 gate, so nothing could clear it. Do NOT ship a threshold change as a quick win — dropping to 0.25 makes only 6 customers eligible.",
    ros: "ROS-033",
  },
  {
    loop: "gsc-pipeline",
    produces: "search_performance rows ingested",
    healthyPerRun: { min: 1 },
    expectedRunsPerWeek: 7,
    // A completed run authorised in July finished in 6s with 4,412 rows, after
    // six consecutive runs were killed at the 240s cap. The ceiling is the
    // signal; the floor is not.
    maxDurationMs: 120_000,
    firstCheck:
      "Check run duration against the 240s cap and whether the Discover request 400'd. nickstire.org has no Discover traffic (ROS-029) — an empty Discover slice is not a failure.",
    ros: "ROS-029",
  },
  {
    loop: "db-backup",
    produces: "verified archive uploads",
    healthyPerRun: { min: 1 },
    expectedRunsPerWeek: 7,
    firstCheck:
      "Confirm the archive POST response was checked. This job faked success two ways before ROS-028: an unchecked POST and a catch block that returned normally.",
    ros: "ROS-028",
  },
  {
    loop: "ig-autopost",
    produces: "drafts generated",
    healthyPerRun: { min: 1 },
    dormantAfterRuns: 3,
    expectedRunsPerWeek: 7,
    firstCheck:
      'Check whether the job swallowed its own status:"failed" (ROS-028) and whether the quality gate rejected every draft.',
    ros: "ROS-028",
  },
  {
    loop: "sms-response-jobs",
    produces: "inbound response jobs reaching a terminal status",
    healthyPerRun: { min: 0 },
    dormantAfterRuns: 14,
    // Boot sweep plus a 45s timer. Zero is normal on a quiet hour; a long run
    // of zeroes while inbound messages exist is not.
    expectedRunsPerWeek: 7,
    firstCheck:
      "Compare terminal-status jobs against inbound message volume. A pending backlog with zero terminal transitions means the processor is not draining.",
    ros: "ROS-042",
  },
  {
    loop: "outbound-sms-queue",
    produces: "queued messages drained to sent",
    healthyPerRun: { min: 0 },
    dormantAfterRuns: 7,
    expectedRunsPerWeek: 7,
    firstCheck:
      "Count rows stuck in `sending`. Rehydration only ever selects `queued`, so a row left in `sending` is unrecoverable and must be reset deliberately. 136 messages accumulated this way over seven weeks (ROS-020).",
    ros: "ROS-020",
  },
  {
    loop: "declined-work-recovery",
    produces: "recovery messages dispatched",
    healthyPerRun: { min: 0 },
    dormantAfterRuns: 7,
    expectedRunsPerWeek: 7,
    firstCheck:
      "Check the open declined-work value. A $0 reading hid a real $52,313 of recoverable work before ROS-036 — null is not zero.",
    ros: "ROS-036",
  },
]);

const BY_LOOP = new Map(LOOP_CONTRACTS.map((c) => [c.loop, c]));

export function getLoopContract(loop: string): LoopShapeContract | undefined {
  return BY_LOOP.get(loop);
}

/**
 * Classify one observed run against its contract.
 *
 * Pure. No clock, no database, no alerting — pass in what was observed and get
 * back a verdict. The ordering below matters: a failed run is a failure even if
 * it produced nothing, and an unmeasured output is `unknown`, never healthy.
 */
export function classifyRun(observed: ObservedRun): LoopFinding {
  const contract = getLoopContract(observed.loop);
  if (!contract) {
    return {
      loop: observed.loop,
      verdict: "unknown",
      summary: `No shape contract declared for "${observed.loop}" — its output is unjudged.`,
      firstCheck: "Add a contract to LOOP_CONTRACTS so this loop's silence is auditable.",
      actionable: true,
    };
  }

  const base = { loop: contract.loop, firstCheck: contract.firstCheck, ros: contract.ros };

  if (!observed.succeeded) {
    return {
      ...base,
      verdict: "failed",
      summary: `${contract.loop} failed. Ordinary failure handling owns this.`,
      actionable: true,
    };
  }

  // An unmeasured output is the ROS-028 hole: the run said "completed" and
  // nobody counted what it made. Never resolve that to healthy.
  if (observed.produced === null || observed.produced === undefined) {
    return {
      ...base,
      verdict: "unknown",
      summary: `${contract.loop} reported success without measuring ${contract.produces}. Completion is not output.`,
      actionable: true,
    };
  }

  if (observed.runsInWindow !== undefined && observed.runsInWindow < contract.expectedRunsPerWeek / 2) {
    return {
      ...base,
      verdict: "missing",
      summary: `${contract.loop} ran ${observed.runsInWindow} times in 7 days, expected about ${contract.expectedRunsPerWeek}.`,
      actionable: true,
    };
  }

  if (contract.maxDurationMs && observed.durationMs && observed.durationMs > contract.maxDurationMs) {
    return {
      ...base,
      verdict: "anomalous",
      summary: `${contract.loop} took ${Math.round(observed.durationMs / 1000)}s, over its ${Math.round(contract.maxDurationMs / 1000)}s budget.`,
      actionable: true,
    };
  }

  // Dormancy is checked before the floor so a loop that legitimately idles
  // (min: 0) still gets caught when it idles forever — the cross_sell case.
  const zeroStreak = (observed.priorZeroRuns ?? 0) + (observed.produced === 0 ? 1 : 0);
  if (
    contract.dormantAfterRuns !== undefined &&
    observed.produced === 0 &&
    zeroStreak >= contract.dormantAfterRuns
  ) {
    return {
      ...base,
      verdict: "dormant",
      summary: `${contract.loop} has produced no ${contract.produces} for ${zeroStreak} consecutive runs while reporting success.`,
      actionable: true,
    };
  }

  if (observed.produced < contract.healthyPerRun.min) {
    return {
      ...base,
      verdict: "anomalous",
      summary: `${contract.loop} produced ${observed.produced} ${contract.produces}, below its floor of ${contract.healthyPerRun.min}.`,
      actionable: true,
    };
  }

  if (contract.healthyPerRun.max !== undefined && observed.produced > contract.healthyPerRun.max) {
    return {
      ...base,
      verdict: "anomalous",
      summary: `${contract.loop} produced ${observed.produced} ${contract.produces}, above its ceiling of ${contract.healthyPerRun.max}.`,
      actionable: true,
    };
  }

  return {
    ...base,
    verdict: "in-spec",
    summary: `${contract.loop} produced ${observed.produced} ${contract.produces}.`,
    actionable: false,
  };
}

/** Classify a batch and return only what an operator should see. */
export function findActionable(runs: readonly ObservedRun[]): LoopFinding[] {
  return runs.map(classifyRun).filter((f) => f.actionable);
}

/**
 * Loops with no declared contract. Coverage gaps are themselves a finding — a
 * loop nobody declared is a loop nobody is watching.
 */
export function undeclaredLoops(knownLoopNames: readonly string[]): string[] {
  return knownLoopNames.filter((n) => !BY_LOOP.has(n));
}
