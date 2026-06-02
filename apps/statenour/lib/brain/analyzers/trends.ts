/**
 * Trend analyzer engine · 2026-06-02
 *
 * Generalizes the `health-trend-analyzer` skill's methodology (multi-dimension
 * trend detection · change-point detection · threshold-aware direction ·
 * pairwise correlation · honest data-gap handling) from health-only to ALL of
 * the operator's tracked daily metrics. It answers "what's changing across my
 * life and what moves together" — distinct from the mental-health analyzer,
 * which is a mood-focused wellbeing read.
 *
 * Methodology ported (translated from the source skill, Chinese):
 *   · 多维度趋势分析 → per-metric OLS slope → per-30-day change + direction
 *   · 变化检测 (滑动窗口t检验) → split the window in half, compare recent-vs-
 *     prior means, flag a notable change-point
 *   · 皮尔逊相关系数 → pairwise Pearson among metrics, surface |r|>=0.5
 *   · 阈值/方向 → respect whether higher=better; report direction, never moralize
 *   · 仅基于已记录的数据 / 数据不足提示 → per-metric "insufficient data" when
 *     <5 points + an overall honest note. Nothing fabricated.
 *
 * Data sources (the operator's OWN logs · Decimals normalized via Number()):
 *   · PersonalDailyLog — moodScore/energyScore (1-10), sleepHours, dailyScore,
 *     driftIncidents, deepWorkBlocks, workoutCompleted
 *   · BodyTracking — weight, bodyFatPct, waistInches, sleepHours, energy (1-10),
 *     stress (1-10), workoutDone
 *
 * Architecture (mirrors mental-health.ts / goal.ts exactly): a pure core
 * `computeTrends(series, now)` (unit-tested, no IO, `now` injected for
 * determinism) + a thin IO wrapper `analyzeTrends({days})` (prisma reads ->
 * compute). The agent tool (lib/ai/tools/brain.ts) lazy-imports the wrapper.
 * No model call.
 */
import { prisma } from "@/lib/prisma";
import { daysAgo, toDateString } from "@/lib/utils/datetime";

// ── pure stats helpers (same shape as mental-health.ts) ─────────────────
function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
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
/** Pearson r. null when n<3 or either series is flat (no correlation defined). */
function pearson(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  const mx = mean(xs.slice(0, n));
  const my = mean(ys.slice(0, n));
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}
function round(n: number, d = 2): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}
const MS_PER_DAY = 86_400_000;

/** Minimum logged points for a metric to be trended (matches the skill's
 *  "数据不足" guard; <5 is reported as an insufficient-data gap, not a trend). */
const MIN_POINTS = 5;

// ── types ──────────────────────────────────────────────────────────────
export type Direction = "rising" | "flat" | "falling";

/** A single normalized observation for one metric: a Date + a numeric value. */
export interface MetricPoint {
  date: Date;
  value: number;
}

/**
 * One tracked metric the analyzer knows how to read. `higherIsBetter` drives
 * NOTHING about scoring (this analyzer never moralizes) — it's carried through
 * so Nick can interpret direction correctly (e.g. weight is context-dependent;
 * `null` = don't assume a good/bad polarity).
 */
export interface MetricSeries {
  name: string;
  unit: string;
  higherIsBetter: boolean | null;
  points: MetricPoint[];
}

export interface ChangePoint {
  priorAvg: number;
  recentAvg: number;
  delta: number; // recentAvg - priorAvg, in the metric's own units
  shifted: boolean; // true when |delta| clears the notable-shift threshold
}

export interface MetricTrend {
  name: string;
  unit: string;
  higherIsBetter: boolean | null;
  points: number;
  avg: number | null;
  perMonthChange: number | null; // slope * 30, metric units per 30 days
  direction: Direction;
  changePoint: ChangePoint | null;
  insufficient: boolean; // <MIN_POINTS points → reported, not trended
}

export interface TopMover {
  name: string;
  unit: string;
  perMonthChange: number;
  normalizedChange: number; // |change| / avg-magnitude — comparable across metrics
  direction: Direction;
}

export interface MetricCorrelation {
  a: string;
  b: string;
  r: number;
  strength: "moderate" | "strong";
  pairs: number;
}

export interface TrendAnalysis {
  window: { days: number };
  dataCompleteness: {
    metricsTracked: number;
    metricsWithTrend: number;
    totalPoints: number;
    sufficient: boolean;
    note: string;
  };
  metrics: MetricTrend[];
  topMovers: TopMover[];
  correlations: MetricCorrelation[];
  guidance: string[];
}

/** Notable-shift threshold per metric. A metric with a defined floor uses that
 *  floor directly — it encodes domain knowledge (a ~2 lb weight move is
 *  notable; a percentage of a 180 lb baseline would set the bar absurdly high).
 *  Unknown metrics fall back to max(1, 15% of |priorAvg|) so the test still
 *  scales sensibly without hard-coding every possible metric. */
const SHIFT_FLOORS: Record<string, number> = {
  weight: 2, // lbs
  bodyFatPct: 1,
  waistInches: 0.75,
  dailyScore: 8,
  deepWorkBlocks: 1,
  driftIncidents: 1,
  // 1-10 scales — a full-point shift in the recent-vs-prior mean is notable
  mood: 1,
  energy: 1,
  "energy(body)": 1,
  stress: 1,
  sleepHours: 1,
  "sleepHours(body)": 1,
  workout: 0.25, // proportion of workout days (0-1)
};
function shiftThreshold(metricName: string, priorAvg: number): number {
  const floor = SHIFT_FLOORS[metricName];
  if (floor != null) return floor;
  return Math.max(1, Math.abs(priorAvg) * 0.15);
}

function directionOf(perMonth: number): Direction {
  if (perMonth >= 0.5) return "rising";
  if (perMonth <= -0.5) return "falling";
  return "flat";
}

/** Build one metric's trend block. Sorts by date, runs slope + change-point. */
function trendOf(series: MetricSeries): MetricTrend {
  const pts = [...series.points].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );
  const base: Omit<MetricTrend, "avg" | "perMonthChange" | "direction" | "changePoint"> = {
    name: series.name,
    unit: series.unit,
    higherIsBetter: series.higherIsBetter,
    points: pts.length,
    insufficient: pts.length < MIN_POINTS,
  };

  if (pts.length < MIN_POINTS) {
    return { ...base, avg: pts.length ? round(mean(pts.map((p) => p.value))) : null, perMonthChange: null, direction: "flat", changePoint: null };
  }

  const vals = pts.map((p) => p.value);
  const t0 = pts[0].date.getTime();
  const xsDays = pts.map((p) => (p.date.getTime() - t0) / MS_PER_DAY);
  const perMonthChange = round(slope(xsDays, vals) * 30);
  const avg = round(mean(vals));

  // Change-point: split the window in half by position, compare means.
  const mid = Math.floor(pts.length / 2);
  const priorAvg = round(mean(vals.slice(0, mid)));
  const recentAvg = round(mean(vals.slice(mid)));
  const delta = round(recentAvg - priorAvg);
  const changePoint: ChangePoint = {
    priorAvg,
    recentAvg,
    delta,
    shifted: Math.abs(delta) >= shiftThreshold(series.name, priorAvg),
  };

  return { ...base, avg, perMonthChange, direction: directionOf(perMonthChange), changePoint };
}

/**
 * Pure analysis core — synthetic-testable, `now` injected (no Date.now).
 * Takes the already-fetched, number-normalized metric series and returns the
 * full grounded trend analysis.
 */
export function computeTrends(series: MetricSeries[], now: Date): TrendAnalysis {
  const days =
    Math.round(
      (now.getTime() -
        Math.min(
          ...series.flatMap((s) => s.points.map((p) => p.date.getTime())),
          now.getTime(),
        )) /
        MS_PER_DAY,
    ) || 0;

  const metrics = series.map(trendOf);
  const trended = metrics.filter((m) => !m.insufficient);
  const totalPoints = series.reduce((a, s) => a + s.points.length, 0);
  const sufficient = trended.length > 0;

  const dataCompleteness = {
    metricsTracked: series.filter((s) => s.points.length > 0).length,
    metricsWithTrend: trended.length,
    totalPoints,
    sufficient,
    note: sufficient
      ? `Trended ${trended.length} metric(s) with >=${MIN_POINTS} logged points over ~${days} days. Metrics with fewer points are listed as insufficient, not trended.`
      : totalPoints === 0
        ? "No tracked metrics logged in this window. Log daily check-ins (mood/energy/sleep) and body tracking so Nick can detect trends."
        : `No metric has >=${MIN_POINTS} logged points yet — trends are directional at best. Keep logging daily.`,
  };

  // ── top movers — biggest absolute NORMALIZED change (comparable across the
  //    mixed scales: 1-10 mood vs ~180 lb weight). normalizedChange =
  //    |perMonthChange| / max(|avg|, 1). ──
  const topMovers: TopMover[] = trended
    .filter((m) => m.perMonthChange != null && m.avg != null && m.direction !== "flat")
    .map((m) => ({
      name: m.name,
      unit: m.unit,
      perMonthChange: m.perMonthChange as number,
      normalizedChange: round(
        Math.abs(m.perMonthChange as number) / Math.max(Math.abs(m.avg as number), 1),
        3,
      ),
      direction: m.direction,
    }))
    .sort((a, b) => b.normalizedChange - a.normalizedChange)
    .slice(0, 5);

  // ── correlations — pairwise Pearson over date-aligned same-day pairs among
  //    trended metrics; surface |r|>=0.5. ──
  const byDate = new Map<string, Map<string, number>>();
  for (const s of series) {
    const seen = new Set<string>();
    for (const p of s.points) {
      const key = toDateKey(p.date);
      // first value per (metric, day) wins — guards against accidental dupes
      if (seen.has(key)) continue;
      seen.add(key);
      let row = byDate.get(key);
      if (!row) {
        row = new Map();
        byDate.set(key, row);
      }
      row.set(s.name, p.value);
    }
  }
  const trendedNames = trended.map((m) => m.name);
  const correlations: MetricCorrelation[] = [];
  for (let i = 0; i < trendedNames.length; i++) {
    for (let j = i + 1; j < trendedNames.length; j++) {
      const a = trendedNames[i];
      const b = trendedNames[j];
      const xs: number[] = [];
      const ys: number[] = [];
      for (const row of byDate.values()) {
        if (row.has(a) && row.has(b)) {
          xs.push(row.get(a) as number);
          ys.push(row.get(b) as number);
        }
      }
      const r = pearson(xs, ys);
      if (r != null && Math.abs(r) >= 0.5) {
        correlations.push({
          a,
          b,
          r: round(r),
          strength: Math.abs(r) >= 0.7 ? "strong" : "moderate",
          pairs: xs.length,
        });
      }
    }
  }
  correlations.sort((p, q) => Math.abs(q.r) - Math.abs(p.r));

  // ── grounded guidance (derived from the metrics — never invented) ──
  const guidance: string[] = [];
  if (!sufficient) {
    guidance.push(
      `Not enough logged data to call any trend (need >=${MIN_POINTS} points per metric). Keep the daily check-in going.`,
    );
  } else {
    const shifts = metrics.filter((m) => m.changePoint?.shifted);
    if (topMovers.length > 0) {
      const top = topMovers[0];
      guidance.push(
        `Biggest mover: ${top.name} is ${top.direction} (${top.perMonthChange > 0 ? "+" : ""}${top.perMonthChange}${top.unit ? " " + top.unit : ""}/mo).`,
      );
    }
    if (shifts.length > 0) {
      const s = shifts[0];
      const cp = s.changePoint as ChangePoint;
      guidance.push(
        `Recent shift in ${s.name}: the second half of the window averaged ${cp.recentAvg} vs ${cp.priorAvg} before (${cp.delta > 0 ? "+" : ""}${cp.delta}${s.unit ? " " + s.unit : ""}).`,
      );
    }
    if (correlations.length > 0) {
      const c = correlations[0];
      guidance.push(
        `Strongest correlation: ${c.a} and ${c.b} move ${c.r > 0 ? "together" : "inversely"} (r=${c.r}, ${c.pairs} shared days) — ${c.r > 0 ? "lifting one tends to lift the other" : "more of one tends to mean less of the other"}.`,
      );
    }
    if (guidance.length === 0) {
      guidance.push(
        "Everything tracked is roughly flat with no notable shifts or strong correlations. Steady state — keep logging so Nick can catch the next move.",
      );
    }
  }

  return {
    window: { days },
    dataCompleteness,
    metrics,
    topMovers,
    correlations,
    guidance,
  };
}

/** YYYY-MM-DD key in ET for date-aligning correlation pairs. */
function toDateKey(d: Date): string {
  return toDateString(d);
}

// ── metric definitions — the single source of truth for what's tracked ───
// Adding a metric here is the only edit needed to extend the analyzer.
interface DailyMetricDef {
  name: string;
  unit: string;
  higherIsBetter: boolean | null;
  pick: (d: DailyLogRow) => number | null;
}
interface BodyMetricDef {
  name: string;
  unit: string;
  higherIsBetter: boolean | null;
  pick: (b: BodyRow) => number | null;
}

interface DailyLogRow {
  logDate: Date;
  moodScore: number | null;
  energyScore: number | null;
  sleepHours: number | null;
  dailyScore: number | null;
  driftIncidents: number;
  deepWorkBlocks: number;
  workoutCompleted: boolean;
}
interface BodyRow {
  date: string;
  weight: number | null;
  bodyFatPct: number | null;
  waistInches: number | null;
  sleepHours: number | null;
  energy: number | null;
  stress: number | null;
  workoutDone: boolean | null;
}

const DAILY_METRICS: DailyMetricDef[] = [
  { name: "mood", unit: "/10", higherIsBetter: true, pick: (d) => d.moodScore },
  { name: "energy", unit: "/10", higherIsBetter: true, pick: (d) => d.energyScore },
  { name: "sleepHours", unit: "h", higherIsBetter: true, pick: (d) => d.sleepHours },
  { name: "dailyScore", unit: "", higherIsBetter: true, pick: (d) => d.dailyScore },
  { name: "deepWorkBlocks", unit: "", higherIsBetter: true, pick: (d) => d.deepWorkBlocks },
  { name: "driftIncidents", unit: "", higherIsBetter: false, pick: (d) => d.driftIncidents },
  { name: "workout", unit: "", higherIsBetter: true, pick: (d) => (d.workoutCompleted ? 1 : 0) },
];

// BodyTracking energy/sleep overlap PersonalDailyLog's — suffixed `(body)` so
// the two sources stay distinct and never silently merge into one series.
const BODY_METRICS: BodyMetricDef[] = [
  { name: "weight", unit: "lb", higherIsBetter: null, pick: (b) => b.weight },
  { name: "bodyFatPct", unit: "%", higherIsBetter: null, pick: (b) => b.bodyFatPct },
  { name: "waistInches", unit: "in", higherIsBetter: null, pick: (b) => b.waistInches },
  { name: "stress", unit: "/10", higherIsBetter: false, pick: (b) => b.stress },
  { name: "energy(body)", unit: "/10", higherIsBetter: true, pick: (b) => b.energy },
  { name: "sleepHours(body)", unit: "h", higherIsBetter: true, pick: (b) => b.sleepHours },
];

/** Build the MetricSeries[] from raw rows. Exported for the IO wrapper + tests. */
export function buildSeries(daily: DailyLogRow[], body: BodyRow[]): MetricSeries[] {
  const out: MetricSeries[] = [];
  for (const def of DAILY_METRICS) {
    const points: MetricPoint[] = [];
    for (const d of daily) {
      const v = def.pick(d);
      if (v != null) points.push({ date: d.logDate, value: v });
    }
    out.push({ name: def.name, unit: def.unit, higherIsBetter: def.higherIsBetter, points });
  }
  for (const def of BODY_METRICS) {
    const points: MetricPoint[] = [];
    for (const b of body) {
      const v = def.pick(b);
      if (v != null) points.push({ date: new Date(b.date), value: v });
    }
    out.push({ name: def.name, unit: def.unit, higherIsBetter: def.higherIsBetter, points });
  }
  return out;
}

/**
 * IO wrapper — reads the operator's own logs and runs the pure core.
 * Each read degrades to [] on error so the tool never throws (mirrors the
 * other brain-tool readers).
 */
export async function analyzeTrends({
  days = 30,
}: { days?: number } = {}): Promise<TrendAnalysis> {
  const since = daysAgo(days);
  const sinceStr = toDateString(since);
  const [dailyRaw, bodyRaw] = await Promise.all([
    prisma.personalDailyLog
      .findMany({
        where: { logDate: { gte: since } },
        orderBy: { logDate: "asc" },
        select: {
          logDate: true,
          moodScore: true,
          energyScore: true,
          sleepHours: true,
          dailyScore: true,
          driftIncidents: true,
          deepWorkBlocks: true,
          workoutCompleted: true,
        },
      })
      .catch((): never[] => []),
    prisma.bodyTracking
      .findMany({
        where: { date: { gte: sinceStr } },
        orderBy: { date: "asc" },
        select: {
          date: true,
          weight: true,
          bodyFatPct: true,
          waistInches: true,
          sleepHours: true,
          energy: true,
          stress: true,
          workoutDone: true,
        },
      })
      .catch((): never[] => []),
  ]);

  const daily: DailyLogRow[] = dailyRaw.map((d) => ({
    logDate: d.logDate,
    moodScore: d.moodScore,
    energyScore: d.energyScore,
    sleepHours: d.sleepHours == null ? null : Number(d.sleepHours),
    dailyScore: d.dailyScore,
    driftIncidents: d.driftIncidents,
    deepWorkBlocks: d.deepWorkBlocks,
    workoutCompleted: d.workoutCompleted,
  }));
  const body: BodyRow[] = bodyRaw.map((b) => ({
    date: b.date,
    weight: b.weight,
    bodyFatPct: b.bodyFatPct,
    waistInches: b.waistInches,
    sleepHours: b.sleepHours,
    energy: b.energy,
    stress: b.stress,
    workoutDone: b.workoutDone,
  }));

  return computeTrends(buildSeries(daily, body), new Date());
}
