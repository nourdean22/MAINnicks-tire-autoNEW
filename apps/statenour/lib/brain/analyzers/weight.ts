/**
 * Weight / body-composition trend analyzer engine · 2026-06-02
 *
 * Ports the `weightloss-analyzer` skill's TREND methodology (weight trajectory
 * + rate of change + body-composition trend + goal distance) GROUNDED in the
 * operator's own BodyTracking rows. CRITICAL anti-fabrication rules baked in:
 *   · DIRECTION-NEUTRAL — it reports the change and rate, and NEVER labels a
 *     direction good / bad / healthy. Whether losing or gaining is "good"
 *     depends on the operator's goal, which Nick reads from the LifeGoal, not
 *     from a moral prior.
 *   · NO BMR / TDEE / calorie math — statenour stores no height or age, so any
 *     metabolic number would be fabricated. Omitted entirely.
 *   · Honest data gaps — a thin window is reported, not extrapolated.
 *
 * Data sources (the operator's OWN logs):
 *   · BodyTracking.weight / bodyFatPct / waistInches (Float?)
 *   · LifeGoal — if an active goal's metric contains "weight", surface the
 *     distance from the latest weight to its targetValue (no judgment on it).
 *
 * Architecture (mirrors mental-health.ts / goal.ts / trends.ts EXACTLY): a pure
 * core `computeWeightTrend(input, now)` (unit-tested, no IO, `now` injected) +
 * a thin IO wrapper `analyzeWeightTrend({days})` (prisma reads -> compute). The
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

/** Minimum logged points for a reliable trend (a thinner window is directional). */
const MIN_POINTS = 5;

// ── types ────────────────────────────────────────────────────────────────
/** Direction is described WITHOUT polarity — never good/bad. */
export type WeightDirection = "rising" | "flat" | "falling";

export interface BodyRow {
  date: string;
  weight: number | null;
  bodyFatPct: number | null;
  waistInches: number | null;
}

/** Minimal active weight-goal shape (only the fields this analyzer reads). */
export interface WeightGoalInput {
  metric: string;
  targetValue: number;
  unit: string;
}

/** One metric's trajectory block — neutral, no judgment. */
export interface MetricTrajectory {
  unit: string;
  points: number;
  latest: number;
  earliest: number;
  netChange: number; // latest - earliest, over the window
  perWeekChange: number; // slope * 7, units per 7 days
  direction: WeightDirection;
  insufficient: boolean; // <MIN_POINTS points -> reported, not trended
}

export interface WeightAnalysis {
  window: { days: number };
  dataCompleteness: {
    weightPoints: number;
    bodyFatPoints: number;
    waistPoints: number;
    sufficient: boolean;
    note: string;
  };
  weight: MetricTrajectory | null;
  bodyFat: MetricTrajectory | null;
  waist: MetricTrajectory | null;
  /** Present only when an active LifeGoal's metric contains "weight". Neutral. */
  goal: {
    targetValue: number;
    unit: string;
    currentWeight: number;
    distanceToTarget: number; // currentWeight - targetValue (signed, no judgment)
  } | null;
  guidance: string[];
}

/** Magnitude bar for calling a direction (mirrors trends.ts directionOf, but
 *  per-week and per-metric since weight/bodyFat/waist live on different scales). */
function directionOf(perWeek: number, floor: number): WeightDirection {
  if (perWeek >= floor) return "rising";
  if (perWeek <= -floor) return "falling";
  return "flat";
}

/** Build one metric's neutral trajectory from date+value points. */
function trajectoryOf(
  points: { date: Date; value: number }[],
  unit: string,
  directionFloor: number,
): MetricTrajectory | null {
  if (points.length === 0) return null;
  const sorted = [...points].sort((a, b) => a.date.getTime() - b.date.getTime());
  const vals = sorted.map((p) => p.value);
  const latest = round(vals[vals.length - 1], 1);
  const earliest = round(vals[0], 1);
  const netChange = round(latest - earliest, 1);

  if (sorted.length < MIN_POINTS) {
    return {
      unit,
      points: sorted.length,
      latest,
      earliest,
      netChange,
      perWeekChange: 0,
      direction: "flat",
      insufficient: true,
    };
  }

  const t0 = sorted[0].date.getTime();
  const xsDays = sorted.map((p) => (p.date.getTime() - t0) / MS_PER_DAY);
  const perWeekChange = round(slope(xsDays, vals) * 7, 2);
  return {
    unit,
    points: sorted.length,
    latest,
    earliest,
    netChange,
    perWeekChange,
    direction: directionOf(perWeekChange, directionFloor),
    insufficient: false,
  };
}

/**
 * Pure analysis core — synthetic-testable, `now` accepted for signature parity
 * with the sibling analyzers (weight math is `now`-independent; the param keeps
 * the call shape uniform).
 */
export function computeWeightTrend(
  args: {
    body: BodyRow[];
    weightGoal: WeightGoalInput | null;
    days: number;
  },
  _now: Date,
): WeightAnalysis {
  const { body, weightGoal, days } = args;

  const weightPts = body
    .filter((b) => b.weight != null)
    .map((b) => ({ date: new Date(b.date), value: b.weight as number }));
  const bodyFatPts = body
    .filter((b) => b.bodyFatPct != null)
    .map((b) => ({ date: new Date(b.date), value: b.bodyFatPct as number }));
  const waistPts = body
    .filter((b) => b.waistInches != null)
    .map((b) => ({ date: new Date(b.date), value: b.waistInches as number }));

  // direction floors: ~0.2 lb/wk, ~0.1 %/wk, ~0.1 in/wk = a real weekly move.
  const weight = trajectoryOf(weightPts, "lb", 0.2);
  const bodyFat = trajectoryOf(bodyFatPts, "%", 0.1);
  const waist = trajectoryOf(waistPts, "in", 0.1);

  const sufficient = weight != null && !weight.insufficient;
  const dataCompleteness = {
    weightPoints: weightPts.length,
    bodyFatPoints: bodyFatPts.length,
    waistPoints: waistPts.length,
    sufficient,
    note: sufficient
      ? `Based on ${weightPts.length} weight log(s) over ~${days} days.`
      : weightPts.length === 0
        ? "No weight logged in this window. Log weight in /body so Nick can track the trend."
        : `Only ${weightPts.length} weight log(s) — need >=${MIN_POINTS} for a reliable trend. Treat this as directional.`,
  };

  // ── goal distance — neutral, only when an active weight goal exists + we
  //    have a latest weight to compare. The sign is informational, never
  //    labeled good/bad. ──
  let goal: WeightAnalysis["goal"] = null;
  if (weightGoal != null && weight != null) {
    goal = {
      targetValue: round(weightGoal.targetValue, 1),
      unit: weightGoal.unit || "lb",
      currentWeight: weight.latest,
      distanceToTarget: round(weight.latest - weightGoal.targetValue, 1),
    };
  }

  // ── grounded guidance — describes the move + distance, NEVER moralizes. ──
  const guidance: string[] = [];
  if (weight != null && !weight.insufficient && weight.direction !== "flat") {
    guidance.push(
      `Weight is ${weight.direction} ${weight.perWeekChange > 0 ? "+" : ""}${weight.perWeekChange} lb/wk (net ${weight.netChange > 0 ? "+" : ""}${weight.netChange} lb over the window).`,
    );
  } else if (weight != null && !weight.insufficient) {
    guidance.push(`Weight is flat at ~${weight.latest} lb over the window.`);
  }
  if (goal != null) {
    const d = goal.distanceToTarget;
    guidance.push(
      d === 0
        ? `You're at your weight target of ${goal.targetValue} ${goal.unit}.`
        : `${Math.abs(d)} ${goal.unit} ${d > 0 ? "above" : "below"} your weight target of ${goal.targetValue} ${goal.unit}.`,
    );
  }
  if (bodyFat != null && !bodyFat.insufficient && bodyFat.direction !== "flat") {
    guidance.push(
      `Body fat is ${bodyFat.direction} (${bodyFat.perWeekChange > 0 ? "+" : ""}${bodyFat.perWeekChange} %/wk).`,
    );
  }
  if (waist != null && !waist.insufficient && waist.direction !== "flat") {
    guidance.push(
      `Waist is ${waist.direction} (${waist.perWeekChange > 0 ? "+" : ""}${waist.perWeekChange} in/wk).`,
    );
  }
  if (!sufficient) {
    guidance.push(`Log weight on >=${MIN_POINTS} days to unlock a reliable trend.`);
  }
  if (guidance.length === 0) {
    guidance.push(
      "Not enough body-composition movement to call a trend. Keep logging so Nick can track it.",
    );
  }

  return {
    window: { days },
    dataCompleteness,
    weight,
    bodyFat,
    waist,
    goal,
    guidance,
  };
}

/**
 * IO wrapper — reads the operator's own body logs + any active weight goal and
 * runs the pure core. Each read degrades to [] / null on error so the tool
 * never throws (mirrors the other brain-tool readers).
 */
export async function analyzeWeightTrend({
  days = 30,
}: { days?: number } = {}): Promise<WeightAnalysis> {
  const since = daysAgo(days);
  const sinceStr = toDateString(since);
  const [bodyRaw, goalRaw] = await Promise.all([
    prisma.bodyTracking
      .findMany({
        where: { date: { gte: sinceStr } },
        orderBy: { date: "asc" },
        select: { date: true, weight: true, bodyFatPct: true, waistInches: true },
      })
      .catch((): never[] => []),
    // active goals whose metric mentions weight — first one wins (oldest by
    // createdAt for determinism). `contains` is case-insensitive-safe via lower.
    prisma.lifeGoal
      .findMany({
        where: {
          deletedAt: null,
          status: "active",
          metric: { contains: "weight", mode: "insensitive" },
        },
        orderBy: { createdAt: "asc" },
        select: { metric: true, targetValue: true, unit: true },
      })
      .catch((): never[] => []),
  ]);

  const body: BodyRow[] = bodyRaw.map((b) => ({
    date: b.date,
    weight: b.weight,
    bodyFatPct: b.bodyFatPct,
    waistInches: b.waistInches,
  }));
  const weightGoal: WeightGoalInput | null = goalRaw[0]
    ? {
        metric: goalRaw[0].metric,
        targetValue: goalRaw[0].targetValue,
        unit: goalRaw[0].unit,
      }
    : null;

  return computeWeightTrend({ body, weightGoal, days }, new Date());
}
