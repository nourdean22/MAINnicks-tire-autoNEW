/**
 * How much to believe today's lot counts -- one verdict, with its reasons, for the Lot page's
 * strip and for anyone else who rolls the lot up.
 *
 * WHY THIS EXISTS (camera audit 2026-10-07). From 2026-09-28 the vehicle lane reported about
 * a tenth of the pre-cutover business-hour arrivals while every health surface stayed green:
 * the heartbeat proved the detector was RUNNING and nothing compared what it counted with
 * what the shop usually does. On 2026-10-05 the Lot page showed 4 arrivals on a ~40-car day
 * under a "Live" badge. A count is only as good as the camera that produced it and the
 * history it is read against, so this helper says, in words, which of the two is missing.
 *
 * Rules:
 * - The sign camera is the vehicle-truth authority. When it is not HEALTHY the counts are
 *   UNKNOWN, never LOW: "we did not look" is a different claim from "we looked and saw few".
 * - A baseline needs at least two earlier days that actually reported. Fewer is UNKNOWN,
 *   not OK -- a flat line drawn from one day proves nothing.
 * - Early in the day the expected count is small, so a ratio is noise. Below a floor the
 *   verdict is UNKNOWN with the numbers shown, not OK and not LOW.
 * - LOW needs a specific reason the operator can act on: far below the usual pace, mostly
 *   drive-bys, or a camera that dropped repeatedly today.
 * - A read that failed is UNKNOWN. Nothing here turns an absent number into a reassuring one.
 */

export type LotConfidenceLevel = "OK" | "LOW" | "UNKNOWN";

export interface LotConfidenceHour {
  hour: number;
  arrivals: number;
  passThroughs: number;
  /** Average arrivals in this ET hour over the earlier days that reported; null = no history. */
  baselineArrivals: number | null;
}

export interface LotConfidenceActivity {
  hours: readonly LotConfidenceHour[];
  totals: { arrivals: number; passThroughs: number; crossings: number; passThroughShare: number | null };
  history: { priorDaysWithData: number };
}

export interface LotConfidenceSign {
  state: string;
  /** Seconds the camera has been in `state`; null when unknown. */
  stateForSeconds: number | null;
  /** Drops recorded today (moves to an unusable state); null when no event row exists today. */
  dropsToday: number | null;
}

export interface LotConfidenceInput {
  /** `lot.activity` success payload, or how it failed. */
  activity: ({ ok: true } & LotConfidenceActivity) | { ok: false; reason?: string } | null | undefined;
  /** The vehicle-truth camera from `lot.health`; null when health could not be read. */
  sign: LotConfidenceSign | null | undefined;
  /** Shop-local clock, from `localClock(now, BUSINESS.timezone)`. */
  clock: { hour: number; minute: number };
  /**
   * The sign camera's HEALTHY share of business time so far (`lot.health` coverage, audit N2).
   * `pct` null = the shop has not opened; absent or null = not measured (an older server).
   */
  coverage?: { pct: number | null; watchedMinutes: number; elapsedMinutes: number } | null;
}

export interface LotConfidence {
  level: LotConfidenceLevel;
  /** One sentence for the strip. */
  headline: string;
  /** Every reason that contributed, operator-readable, most important first. */
  reasons: string[];
  /** Arrivals the baseline predicts by this moment of the day; null without a baseline. */
  expectedSoFar: number | null;
  observedArrivals: number | null;
}

/**
 * The thresholds. Proposed values; none has been measured against a month of real days yet.
 * The test file restates the two it probes by value, so a change here must be a decision
 * made in both places.
 */
const LOT_CONFIDENCE_RULES = {
  /** Expected count below which a ratio is noise rather than evidence. */
  minExpected: 6,
  /** Observed / expected under this is LOW. */
  lowRatio: 0.5,
  /** Drive-by share above this (with at least `minCrossings`) is LOW. */
  passThroughShare: 0.5,
  minCrossings: 10,
  /** Sign-camera drops today at or above this is LOW. */
  drops: 5,
  /** Earlier days that must have reported before today is compared with anything. */
  minPriorDays: 2,
  /**
   * Below this share of business time watched, today is not compared with the baseline at all
   * (audit N2: "comparisons withheld below 80%"). At or above it the expectation is scaled to
   * the share actually watched, so a camera that missed 10% of the morning is not read as a
   * 10% slow day.
   */
  minCoverage: 0.8,
} as const;

const R = LOT_CONFIDENCE_RULES;

function fmtAge(sec: number | null): string {
  if (sec === null) return "an unknown time";
  if (sec < 60) return `${Math.max(0, Math.round(sec))}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${Math.round(sec / 3600)}h`;
}

/**
 * Arrivals the baseline predicts between the start of the day and `clock`: whole earlier
 * hours in full, the current hour pro rata. Hours with no baseline contribute nothing.
 * Exercised through `lotDataConfidence` (the `expectedSoFar` field) and directly by its test.
 */
function expectedArrivalsSoFar(hours: readonly LotConfidenceHour[], clock: { hour: number; minute: number }): number {
  let total = 0;
  for (const h of hours) {
    if (h.baselineArrivals === null) continue;
    if (h.hour < clock.hour) total += h.baselineArrivals;
    else if (h.hour === clock.hour) total += h.baselineArrivals * (Math.min(59, Math.max(0, clock.minute)) / 60);
  }
  return total;
}

export function lotDataConfidence(input: LotConfidenceInput): LotConfidence {
  const unknown = (headline: string, reasons: string[], extra: Partial<LotConfidence> = {}): LotConfidence => ({
    level: "UNKNOWN", headline, reasons, expectedSoFar: null, observedArrivals: null, ...extra,
  });

  const sign = input.sign;
  if (!sign) {
    return unknown("Camera health could not be read, so today's counts cannot be judged.", ["camera health not loaded"]);
  }
  if (sign.state !== "HEALTHY") {
    const state = sign.state.replace(/_/g, " ").toLowerCase();
    return unknown(
      `Sign camera ${state} for ${fmtAge(sign.stateForSeconds)}: arrivals since then were not observed.`,
      [`sign camera ${state}`],
    );
  }

  const activity = input.activity;
  if (!activity || activity.ok !== true) {
    const reason = activity && activity.ok === false && activity.reason ? activity.reason : "hourly activity could not be read";
    return unknown("Hourly activity could not be read, so today's counts cannot be judged.", [reason]);
  }

  const observed = activity.totals.arrivals;
  const reasons: string[] = [];
  let level: LotConfidenceLevel = "OK";

  if (typeof sign.dropsToday === "number" && sign.dropsToday >= R.drops) {
    level = "LOW";
    reasons.push(`sign camera dropped ${sign.dropsToday} times today; arrivals during the gaps were not observed`);
  }

  const { crossings, passThroughs, passThroughShare } = activity.totals;
  if (crossings >= R.minCrossings && passThroughShare !== null && passThroughShare > R.passThroughShare) {
    level = "LOW";
    reasons.push(`${passThroughs} of ${crossings} crossings today read as drive-bys; the portal may be calling stays pass-throughs`);
  }

  // COVERAGE GATE (audit N2). The counts can only be compared with the usual pace over the
  // minutes the camera actually watched. Below the floor the comparison is withheld, in
  // words, with the minutes; the LOW reasons above (drops, drive-bys) stand on their own.
  const coverage = input.coverage ?? null;
  const watchedShare = coverage && coverage.pct !== null ? Math.min(1, Math.max(0, coverage.pct)) : null;
  if (watchedShare !== null && watchedShare < R.minCoverage) {
    const pctText = `${Math.round(watchedShare * 100)}%`;
    reasons.push(
      `sign camera watched only ${pctText} of business time so far (${coverage!.watchedMinutes} of ${coverage!.elapsedMinutes} min); today is not compared with the baseline`,
    );
    return {
      level: level === "LOW" ? "LOW" : "UNKNOWN",
      headline: level === "LOW"
        ? `${observed} arrivals so far; ${reasons[0]}.`
        : `${observed} arrivals so far; comparison withheld: the sign camera watched only ${pctText} of business time so far.`,
      reasons,
      expectedSoFar: null,
      observedArrivals: observed,
    };
  }

  if (activity.history.priorDaysWithData < R.minPriorDays) {
    const days = activity.history.priorDaysWithData;
    reasons.push(`only ${days} earlier day${days === 1 ? "" : "s"} of history; nothing to compare today against`);
    return {
      level: level === "LOW" ? "LOW" : "UNKNOWN",
      headline: level === "LOW"
        ? `${observed} arrivals so far; ${reasons[0]}.`
        : `${observed} arrivals so far; no baseline yet (${days} earlier day${days === 1 ? "" : "s"} reported).`,
      reasons,
      expectedSoFar: null,
      observedArrivals: observed,
    };
  }

  // Scaled to the share of business time watched (1 when coverage is not measured): the
  // baseline predicts arrivals the camera would have SEEN, not arrivals that happened.
  const expected = expectedArrivalsSoFar(activity.hours, input.clock) * (watchedShare ?? 1);
  const expectedRounded = Math.round(expected);
  const days = activity.history.priorDaysWithData;
  const scaledNote = watchedShare !== null && watchedShare < 1 ? `, scaled to the ${Math.round(watchedShare * 100)}% of business time watched` : "";

  if (expected < R.minExpected) {
    if (level === "LOW") {
      return { level, headline: `${observed} arrivals so far; ${reasons[0]}.`, reasons, expectedSoFar: expected, observedArrivals: observed };
    }
    reasons.push(`about ${expectedRounded} expected by now from the last ${days} days: too few to judge against`);
    return {
      level: "UNKNOWN",
      headline: `${observed} arrivals so far; too early to compare (about ${expectedRounded} usual by now).`,
      reasons,
      expectedSoFar: expected,
      observedArrivals: observed,
    };
  }

  if (observed < expected * R.lowRatio) {
    level = "LOW";
    reasons.unshift(`${observed} arrivals so far vs about ${expectedRounded} usual by now (last ${days} days${scaledNote})`);
  } else {
    reasons.push(`${observed} arrivals so far vs about ${expectedRounded} usual by now (last ${days} days${scaledNote})`);
  }

  return {
    level,
    headline: level === "LOW"
      ? `Counts look low: ${reasons[0]}.`
      : `${observed} arrivals so far vs about ${expectedRounded} usual by now; sign camera healthy.`,
    reasons,
    expectedSoFar: expected,
    observedArrivals: observed,
  };
}
