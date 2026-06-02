/**
 * Work-pattern health analyzer engine · 2026-06-02
 *
 * Reads the operator's work-rhythm + load signals and surfaces a NON-clinical
 * "strain signal" — a heuristic that rises when high stress + high drift + low
 * energy co-occur. CRITICAL anti-fabrication rules: the strain signal is
 * EXPLICITLY a heuristic, NOT a burnout diagnosis or any clinical assessment;
 * a one-line disclaimer ships in the result. Body metrics (energy/stress) are
 * reported as trends, never moralized. Honest data gaps. Nothing invented.
 *
 * Data sources (the operator's OWN logs · Decimals N/A here):
 *   · PersonalDailyLog.deepWorkBlocks (Int) — focus output proxy
 *   · PersonalDailyLog.driftIncidents (Int) — distraction load
 *   · BodyTracking.stress (Int 1-10) — subjective stress
 *   · BodyTracking.energy (Int 1-10) — subjective energy
 *
 * Architecture (mirrors mental-health.ts / goal.ts / trends.ts EXACTLY): a pure
 * core `computeWorkHealth(input, now)` (unit-tested, no IO, `now` injected) +
 * a thin IO wrapper `analyzeWorkHealth({days})` (prisma reads -> compute). The
 * agent tool (lib/ai/tools/brain.ts) lazy-imports the wrapper. No model call.
 */
import { prisma } from "@/lib/prisma";
import { daysAgo, toDateString } from "@/lib/utils/datetime";

// ── pure stats helpers (same shape as the sibling analyzers) ────────────
function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
/** OLS slope of y over x. 0 when x has no spread (single point / flat time). */
function slope(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}
function round(n: number, d = 2): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}
const MS_PER_DAY = 86_400_000;

/** Minimum logged points for a metric to get a trend (a thinner series is directional). */
const MIN_POINTS = 5;

// ── types ────────────────────────────────────────────────────────────────
/** Generic metric trend label. `posIsGood` flips the wording per metric. */
export type WorkTrend = "rising" | "flat" | "falling";
export type StrainLevel = "insufficient-data" | "low" | "elevated" | "high";

export interface DailyWorkRow {
  logDate: Date;
  deepWorkBlocks: number;
  driftIncidents: number;
}
export interface BodyWorkRow {
  date: string;
  stress: number | null;
  energy: number | null;
}

/** One metric's average + neutral direction. null when nothing logged. */
export interface WorkMetric {
  avg: number;
  perMonthChange: number | null; // slope * 30; null when <MIN_POINTS points
  direction: WorkTrend;
  points: number;
}

export interface WorkHealthAnalysis {
  window: { days: number };
  dataCompleteness: {
    dailyLogs: number;
    bodyEntries: number;
    sufficient: boolean;
    note: string;
  };
  deepWork: WorkMetric | null;
  drift: WorkMetric | null;
  stress: WorkMetric | null;
  energy: WorkMetric | null;
  strain: {
    level: StrainLevel;
    points: number;
    factors: string[];
    disclaimer: string;
  };
  guidance: string[];
}

const STRAIN_DISCLAIMER =
  "Strain is a rough heuristic from your own logs (stress + drift + energy), NOT a burnout diagnosis or any clinical assessment. If you're struggling, talk to a professional.";

function directionOf(perMonth: number): WorkTrend {
  if (perMonth >= 0.5) return "rising";
  if (perMonth <= -0.5) return "falling";
  return "flat";
}

/** Build a metric block from date+value points (sorted, slope over real days). */
function metricOf(points: { date: Date; value: number }[]): WorkMetric | null {
  if (points.length === 0) return null;
  const sorted = [...points].sort((a, b) => a.date.getTime() - b.date.getTime());
  const vals = sorted.map((p) => p.value);
  const avg = round(mean(vals));
  if (sorted.length < MIN_POINTS) {
    return { avg, perMonthChange: null, direction: "flat", points: sorted.length };
  }
  const t0 = sorted[0].date.getTime();
  const xsDays = sorted.map((p) => (p.date.getTime() - t0) / MS_PER_DAY);
  const perMonthChange = round(slope(xsDays, vals) * 30);
  return { avg, perMonthChange, direction: directionOf(perMonthChange), points: sorted.length };
}

/**
 * Pure analysis core — synthetic-testable, `now` accepted for signature parity
 * with the sibling analyzers (the math is `now`-independent; the param keeps
 * the call shape uniform).
 */
export function computeWorkHealth(
  args: {
    daily: DailyWorkRow[];
    body: BodyWorkRow[];
    days: number;
  },
  _now: Date,
): WorkHealthAnalysis {
  const { daily, body, days } = args;

  const deepWork = metricOf(
    daily.map((d) => ({ date: d.logDate, value: d.deepWorkBlocks })),
  );
  const drift = metricOf(
    daily.map((d) => ({ date: d.logDate, value: d.driftIncidents })),
  );
  const stress = metricOf(
    body
      .filter((b) => b.stress != null)
      .map((b) => ({ date: new Date(b.date), value: b.stress as number })),
  );
  const energy = metricOf(
    body
      .filter((b) => b.energy != null)
      .map((b) => ({ date: new Date(b.date), value: b.energy as number })),
  );

  // sufficient when we have enough daily logs to read the work side; the body
  // side (stress/energy) is optional context that strengthens the strain read.
  const sufficient = daily.length >= MIN_POINTS;
  const dataCompleteness = {
    dailyLogs: daily.length,
    bodyEntries: body.length,
    sufficient,
    note: sufficient
      ? `Based on ${daily.length} daily log(s)${body.length ? ` + ${body.length} body entr${body.length === 1 ? "y" : "ies"}` : ""} over ~${days} days.`
      : daily.length === 0
        ? "No work-pattern data logged in this window. Log deep-work blocks + drift in the daily check-in so Nick can read your work rhythm."
        : `Only ${daily.length} daily log(s) — need >=${MIN_POINTS} for a reliable read. Treat this as directional.`,
  };

  // ── strain heuristic (NON-clinical) — points accrue when the three load
  //    signals co-occur badly: high stress, high drift, low energy. Mirrors
  //    the mental-health analyzer's explicitly-non-clinical scoring style. ──
  let points = 0;
  const factors: string[] = [];
  if (stress != null) {
    if (stress.avg >= 7) {
      points += 2;
      factors.push(`Sustained high stress (${stress.avg}/10).`);
    } else if (stress.avg >= 5) {
      points += 1;
      factors.push(`Elevated stress (${stress.avg}/10).`);
    }
    if (stress.direction === "rising") {
      points += 1;
      factors.push(`Stress trending up (+${stress.perMonthChange}/mo).`);
    }
  }
  if (drift != null) {
    if (drift.avg >= 5) {
      points += 2;
      factors.push(`High daily drift (${drift.avg} incidents/day).`);
    } else if (drift.avg >= 3) {
      points += 1;
      factors.push(`Moderate daily drift (${drift.avg} incidents/day).`);
    }
    if (drift.direction === "rising") {
      points += 1;
      factors.push(`Drift trending up (+${drift.perMonthChange}/mo).`);
    }
  }
  if (energy != null) {
    if (energy.avg <= 3) {
      points += 2;
      factors.push(`Low energy (${energy.avg}/10).`);
    } else if (energy.avg <= 5) {
      points += 1;
      factors.push(`Below-mid energy (${energy.avg}/10).`);
    }
    if (energy.direction === "falling") {
      points += 1;
      factors.push(`Energy trending down (${energy.perMonthChange}/mo).`);
    }
  }

  let level: StrainLevel;
  if (!sufficient) level = "insufficient-data";
  else if (points >= 5) level = "high";
  else if (points >= 2) level = "elevated";
  else level = "low";
  if (factors.length === 0) {
    factors.push("No elevated strain signals in the logged work-pattern data.");
  }

  // ── grounded guidance (derived from the metrics — never invented) ──
  const guidance: string[] = [];
  if (level === "high") {
    guidance.push(
      "Strain heuristic is HIGH — stress, drift, and energy are stacking against you. This is a pattern signal, not a diagnosis.",
    );
  }
  if (deepWork != null && deepWork.direction === "falling") {
    guidance.push(`Deep-work output is sliding (${deepWork.perMonthChange}/mo) — protect the focus blocks.`);
  } else if (deepWork != null && deepWork.direction === "rising") {
    guidance.push(`Deep-work output is climbing (+${deepWork.perMonthChange}/mo).`);
  }
  if (drift != null && drift.avg >= 3) {
    guidance.push(`Drift is averaging ${drift.avg}/day — the biggest lever on your work rhythm is cutting that.`);
  }
  if (!sufficient) {
    guidance.push(`Log at least ${MIN_POINTS} daily check-ins to unlock a reliable read.`);
  }
  if (guidance.length === 0) {
    guidance.push(
      "Work patterns look steady with no elevated strain. Keep logging deep-work + drift so Nick can catch a shift early.",
    );
  }

  return {
    window: { days },
    dataCompleteness,
    deepWork,
    drift,
    stress,
    energy,
    strain: { level, points, factors, disclaimer: STRAIN_DISCLAIMER },
    guidance,
  };
}

/**
 * IO wrapper — reads the operator's own work-pattern logs and runs the pure
 * core. Each read degrades to [] on error so the tool never throws (mirrors
 * the other brain-tool readers).
 */
export async function analyzeWorkHealth({
  days = 30,
}: { days?: number } = {}): Promise<WorkHealthAnalysis> {
  const since = daysAgo(days);
  const sinceStr = toDateString(since);
  const [dailyRaw, bodyRaw] = await Promise.all([
    prisma.personalDailyLog
      .findMany({
        where: { logDate: { gte: since } },
        orderBy: { logDate: "asc" },
        select: { logDate: true, deepWorkBlocks: true, driftIncidents: true },
      })
      .catch((): never[] => []),
    prisma.bodyTracking
      .findMany({
        where: { date: { gte: sinceStr } },
        orderBy: { date: "asc" },
        select: { date: true, stress: true, energy: true },
      })
      .catch((): never[] => []),
  ]);

  const daily: DailyWorkRow[] = dailyRaw.map((d) => ({
    logDate: d.logDate,
    deepWorkBlocks: d.deepWorkBlocks,
    driftIncidents: d.driftIncidents,
  }));
  const body: BodyWorkRow[] = bodyRaw.map((b) => ({
    date: b.date,
    stress: b.stress,
    energy: b.energy,
  }));

  return computeWorkHealth({ daily, body, days }, new Date());
}
