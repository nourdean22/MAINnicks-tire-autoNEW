/**
 * Hidden Correlation Finder
 *
 * Discovers connections across domains that Nour hasn't noticed.
 * Goes beyond the known causation chains (Body→Business, etc.)
 * to find data-driven correlations that are SURPRISING.
 *
 * Method:
 * 1. Pull daily data across all domains (scores, revenue, habits, weather, etc.)
 * 2. Compute Pearson correlations between all metric pairs
 * 3. Filter for statistically meaningful correlations (r > 0.3 or r < -0.3)
 * 4. Filter out KNOWN causation chains (those aren't surprising)
 * 5. Store surprising findings as brain insights
 *
 * Example discoveries:
 * - "Journal entries on Mondays correlate with 23% higher revenue Tuesdays"
 * - "When open loops exceed 6, your quote follow-up time increases 3x"
 * - "Saturday workouts predict Monday revenue better than Friday workouts"
 */

import { prisma } from "@/lib/prisma";
import { brainMemory } from "@/lib/brain/memory-manager";
import { daysAgo, toDateString } from "@/lib/utils/datetime";
import {
  recentScoreSnapshots,
  recentDailyHabits,
  recentShopJobs,
  recentShopLeads,
} from "@/lib/brain/legacy-shims";

interface Correlation {
  metricA: string;
  metricB: string;
  coefficient: number; // -1 to 1
  strength: "strong" | "moderate" | "weak";
  direction: "positive" | "negative";
  interpretation: string;
  dataPoints: number;
  surprising: boolean; // true if not a known causation chain
}

// Known causation chains (not surprising, already tracked)
const KNOWN_CHAINS = [
  ["workout", "revenue"],
  ["workout", "energy"],
  ["workout", "score"],
  ["energy", "revenue"],
  ["energy", "focus"],
  ["energy", "discipline"],
  ["focus", "discipline"],
  ["discipline", "score"],
  ["score", "energy"],
  ["habitsCompleted", "score"],
  ["habitsCompleted", "discipline"],
  ["journal", "focus"],
  ["sleep", "decisions"],
  ["loops", "anxiety"],
  ["openLoops", "energy"],
  ["stressIndicator", "energy"],
  ["momentumScore", "score"],
];

/**
 * EXPORTED (D-tests): is this metric pair one of the KNOWN causation
 * chains we already surface elsewhere? Used to suppress "surprising"
 * claims on things that are, in fact, not surprising.
 */
export function isKnownChain(a: string, b: string): boolean {
  return KNOWN_CHAINS.some(
    ([x, y]) => (a.includes(x) && b.includes(y)) || (a.includes(y) && b.includes(x))
  );
}

/**
 * EXPORTED (D-tests): Pearson correlation coefficient between two
 * number arrays. Returns 0 when n < 5 (not enough data) or when the
 * denominator is zero (one array is constant).
 */
export function pearson(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 5) return 0;

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i];
    sumY2 += y[i] * y[i];
  }

  const denom = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  if (denom === 0) return 0;

  return (n * sumXY - sumX * sumY) / denom;
}

/**
 * GRANGER-STYLE LAGGED PEARSON (Clive Granger, 1969 — Nobel 2003)
 *
 * True causality requires temporal precedence: does A at time t-lag
 * predict B at time t better than concurrent A↔B? Returns the BEST
 * lag in [1..maxLag] and its coefficient if stronger than concurrent.
 *
 * Standard pearson(A, B) measures concurrent association ("things
 * happen together"). pearsonLagged(A, B, lag) measures whether A's
 * past predicts B's present. Stronger lagged correlation than
 * concurrent = directional signal, not just coincidence.
 */
export function pearsonLagged(
  cause: number[],
  effect: number[],
  lag: number,
): number {
  if (lag <= 0 || lag >= cause.length) return 0;
  // Shift: effect at time t depends on cause at time t-lag
  const shiftedCause = cause.slice(0, cause.length - lag);
  const shiftedEffect = effect.slice(lag);
  return pearson(shiftedCause, shiftedEffect);
}

export interface BestLagResult {
  lag: number;
  coefficient: number;
  /** True when lagged correlation is stronger than concurrent — i.e.
   *  cause→effect timing relationship is real, not coincidence. */
  exceedsConcurrent: boolean;
}

/**
 * Find the strongest leading lag in [1..maxLag]. If none exceed the
 * concurrent correlation, returns lag=0 with the concurrent value.
 */
export function findBestLag(
  cause: number[],
  effect: number[],
  maxLag = 7,
): BestLagResult {
  const concurrent = Math.abs(pearson(cause, effect));
  let bestLag = 0;
  let bestAbs = concurrent;
  let bestCoef = pearson(cause, effect);
  for (let lag = 1; lag <= maxLag; lag++) {
    const r = pearsonLagged(cause, effect, lag);
    if (Math.abs(r) > bestAbs) {
      bestAbs = Math.abs(r);
      bestLag = lag;
      bestCoef = r;
    }
  }
  return {
    lag: bestLag,
    coefficient: bestCoef,
    exceedsConcurrent: bestLag > 0 && bestAbs > concurrent + 0.05, // 0.05 buffer for noise
  };
}

/**
 * BOOTSTRAP CONFIDENCE INTERVAL (Efron, 1979)
 *
 * Counter to Taleb's narrative-fallacy critique: humans see patterns
 * in noise. Bootstrap resamples the data 200x (with replacement) and
 * reports the empirical 95% CI. If the CI crosses zero, the
 * correlation is NOT statistically meaningful — drop it.
 */
// v10.0.46 — replaced Math.random() with a seeded PRNG (mulberry32).
// Pre-fix the same correlation inputs produced different `meaningful`
// verdicts across cron runs, so a borderline-significant correlation
// fired an alert one run, no alert the next. Determinism makes the
// 5-minute alert pipeline replayable and prevents spurious/missing
// drift Telegrams. Seed is derived from the data fingerprint so
// independent correlations don't collide.
function fingerprintSeed(x: number[], y: number[]): number {
  let h = 0x811c9dc5; // FNV-1a offset basis
  for (let i = 0; i < x.length; i++) {
    h = Math.imul(h ^ Math.round(x[i] * 1000), 0x01000193);
    h = Math.imul(h ^ Math.round(y[i] * 1000), 0x01000193);
  }
  // Ensure positive 32-bit integer
  return h >>> 0 || 1;
}

function mulberry32(seed: number): () => number {
  let t = seed | 0;
  return () => {
    t = (t + 0x6D2B79F5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function bootstrapCorrelationCI(
  x: number[],
  y: number[],
  iterations = 200,
): { lo: number; hi: number; meaningful: boolean } {
  const n = Math.min(x.length, y.length);
  if (n < 5) return { lo: 0, hi: 0, meaningful: false };

  const rand = mulberry32(fingerprintSeed(x, y));
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const xi: number[] = [];
    const yi: number[] = [];
    for (let j = 0; j < n; j++) {
      const idx = Math.floor(rand() * n);
      xi.push(x[idx]);
      yi.push(y[idx]);
    }
    const r = pearson(xi, yi);
    if (Number.isFinite(r)) samples.push(r);
  }
  if (samples.length === 0) return { lo: 0, hi: 0, meaningful: false };
  samples.sort((a, b) => a - b);
  const lo = samples[Math.floor(samples.length * 0.025)];
  const hi = samples[Math.floor(samples.length * 0.975)];
  // Meaningful = CI doesn't cross zero
  const meaningful = (lo > 0 && hi > 0) || (lo < 0 && hi < 0);
  return { lo, hi, meaningful };
}

/**
 * SIMPSON'S PARADOX GUARD (Edward Simpson, 1951)
 *
 * Stratify the data by a third variable and check whether the
 * correlation FLIPS sign or weakens dramatically. If yes, the
 * overall correlation is misleading.
 *
 * Returns true when the correlation is stable across strata.
 */
export function isStableAcrossStrata(
  x: number[],
  y: number[],
  strata: string[],
): { stable: boolean; flipsIn: string[] } {
  if (x.length !== y.length || y.length !== strata.length) {
    return { stable: true, flipsIn: [] };
  }
  const overall = pearson(x, y);
  if (Math.abs(overall) < 0.1) return { stable: true, flipsIn: [] };
  const buckets = new Map<string, { x: number[]; y: number[] }>();
  for (let i = 0; i < x.length; i++) {
    const s = strata[i];
    if (!buckets.has(s)) buckets.set(s, { x: [], y: [] });
    const b = buckets.get(s)!;
    b.x.push(x[i]);
    b.y.push(y[i]);
  }
  const flipsIn: string[] = [];
  for (const [stratum, b] of buckets) {
    if (b.x.length < 5) continue;
    const r = pearson(b.x, b.y);
    // Flip = different sign, OR magnitude drops by half
    if (Math.sign(r) !== Math.sign(overall) || Math.abs(r) < Math.abs(overall) / 2) {
      flipsIn.push(stratum);
    }
  }
  return { stable: flipsIn.length === 0, flipsIn };
}

/**
 * REICHENBACH MEDIATOR PROBE (Hans Reichenbach, 1956)
 *
 * When A correlates with B, either A→B, B→A, or both share a hidden
 * cause C. Given a list of CANDIDATE mediators, test each: is the
 * partial correlation A↔B GIVEN C substantially weaker than A↔B
 * alone? If yes, C is a likely mediator.
 *
 * Approximate partial correlation:
 *   r(A,B|C) = (r(A,B) - r(A,C)*r(B,C)) /
 *              sqrt((1 - r(A,C)^2) * (1 - r(B,C)^2))
 */
export function detectMediator(
  a: number[],
  b: number[],
  candidates: Array<{ name: string; series: number[] }>,
): Array<{ name: string; partialR: number; reductionPct: number }> {
  const rAB = pearson(a, b);
  if (Math.abs(rAB) < 0.2) return [];
  const findings: Array<{ name: string; partialR: number; reductionPct: number }> = [];
  for (const c of candidates) {
    if (c.series.length < a.length) continue;
    const rAC = pearson(a, c.series);
    const rBC = pearson(b, c.series);
    const denom = Math.sqrt((1 - rAC * rAC) * (1 - rBC * rBC));
    // Special case: when rAC and rBC are both ~1, the candidate IS
    // a perfect mediator. The denominator goes to 0 (degenerate) but
    // the conclusion is unambiguous — partial r = 0, reduction = 100%.
    if (Math.abs(denom) < 1e-6) {
      if (Math.abs(rAC) > 0.95 && Math.abs(rBC) > 0.95) {
        findings.push({
          name: c.name,
          partialR: 0,
          reductionPct: 100,
        });
      }
      continue;
    }
    const partial = (rAB - rAC * rBC) / denom;
    const reduction = 1 - Math.abs(partial) / Math.abs(rAB);
    if (reduction > 0.3) {
      findings.push({
        name: c.name,
        partialR: partial,
        reductionPct: Math.round(reduction * 100),
      });
    }
  }
  return findings.sort((a, b) => b.reductionPct - a.reductionPct);
}

/**
 * Find hidden correlations across all tracked domains.
 */
export async function findCorrelations(): Promise<Correlation[]> {
  const ninetyDaysAgo = daysAgo(90);

  // Gather daily metrics — expanded to 12+ data sources
  type ScoreRow = { date: string; overallScore: number | null; energyLevel: number | null; focusQuality: number | null; disciplineScore: number | null; workoutDone: boolean; journalDone: boolean; mood: string | null };
  type JobRow = { jobDate: Date; totalRevenue: unknown };
  type HabitRow = { date: string; habitKey: string; completed: boolean };
  type LoopRow = { createdAt: Date };
  type LeadRow = { createdAt: Date; status: string; timeToResponseMinutes: number | null };
  type CommitmentRow = { createdAt: Date; status: string };
  type ChatMessageRow = { createdAt: Date; content: string };

  const [scores, jobs, habits, loops, leads, commitments, chatMessages] = await Promise.all([
    // v10.0.55 · sourced via legacy-shims (scores/habits real;
    // jobs/leads currently empty).
    recentScoreSnapshots(30) as unknown as Promise<ScoreRow[]>,
    recentShopJobs(30) as unknown as Promise<JobRow[]>,
    recentDailyHabits(30) as unknown as Promise<HabitRow[]>,
    // Apr 18: OpenLoop retired → Task createdAt timeline.
    prisma.task
      .findMany({
        where: { createdAt: { gte: ninetyDaysAgo } },
        select: { createdAt: true },
      })
      .catch((): LoopRow[] => []),
    recentShopLeads(30) as unknown as Promise<LeadRow[]>,
    prisma.commitment.findMany({
      where: { createdAt: { gte: ninetyDaysAgo }, deletedAt: null },
      select: { createdAt: true, status: true },
    }).catch((): CommitmentRow[] => []),
    prisma.chatMessage.findMany({
      where: { role: "user", createdAt: { gte: ninetyDaysAgo } },
      select: { createdAt: true, content: true },
    }).catch((): ChatMessageRow[] => []),
  ]);

  if (scores.length < 14) return []; // Need at least 2 weeks of data

  // Build daily vectors
  const dateSet = new Set(scores.map((s) => s.date));
  const dates = [...dateSet].sort();

  // Revenue by date
  const revenueByDate = new Map<string, number>();
  for (const j of jobs) {
    const d = j.jobDate.toISOString().split("T")[0];
    revenueByDate.set(d, (revenueByDate.get(d) ?? 0) + Number(j.totalRevenue));
  }

  // Habit completion by date
  const habitsByDate = new Map<string, number>();
  for (const h of habits) {
    if (h.completed) {
      habitsByDate.set(h.date, (habitsByDate.get(h.date) ?? 0) + 1);
    }
  }

  // Leads by date
  const leadsByDate = new Map<string, number>();
  const avgResponseByDate = new Map<string, number[]>();
  for (const l of leads) {
    const d = l.createdAt.toISOString().split("T")[0];
    leadsByDate.set(d, (leadsByDate.get(d) ?? 0) + 1);
    if (l.timeToResponseMinutes != null && l.timeToResponseMinutes > 0) {
      const arr = avgResponseByDate.get(d) || [];
      arr.push(l.timeToResponseMinutes);
      avgResponseByDate.set(d, arr);
    }
  }

  // Open loops by date (cumulative count at end of day)
  const loopsByDate = new Map<string, number>();
  const sortedLoops = [...loops].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  let cumLoops = 0;
  for (const l of sortedLoops) {
    const d = l.createdAt.toISOString().split("T")[0];
    cumLoops++;
    loopsByDate.set(d, cumLoops);
  }

  // Chat message count by date (engagement proxy)
  const chatsByDate = new Map<string, number>();
  for (const m of chatMessages) {
    const d = m.createdAt.toISOString().split("T")[0];
    chatsByDate.set(d, (chatsByDate.get(d) ?? 0) + 1);
  }

  // Build metric arrays aligned by date — 14 metrics
  const metrics: Record<string, number[]> = {
    score: [],
    energy: [],
    focus: [],
    discipline: [],
    workout: [],
    journal: [],
    revenue: [],
    habitsCompleted: [],
    leadCount: [],
    responseTimeAvg: [],
    openLoops: [],
    chatEngagement: [],
    stressIndicator: [], // derived: low energy + high discipline = grinding
    momentumScore: [], // derived: workout + journal + habits > 3 = momentum
  };

  for (const date of dates) {
    const s = scores.find((sc) => sc.date === date);
    if (!s) continue;

    const energy = s.energyLevel ?? 0;
    const discipline = s.disciplineScore ?? 0;
    const workoutVal = s.workoutDone ? 1 : 0;
    const journalVal = s.journalDone ? 1 : 0;
    const habitsVal = habitsByDate.get(date) ?? 0;

    metrics.score.push(s.overallScore ?? 0);
    metrics.energy.push(energy);
    metrics.focus.push(s.focusQuality ?? 0);
    metrics.discipline.push(discipline);
    metrics.workout.push(workoutVal);
    metrics.journal.push(journalVal);
    metrics.revenue.push(revenueByDate.get(date) ?? 0);
    metrics.habitsCompleted.push(habitsVal);
    metrics.leadCount.push(leadsByDate.get(date) ?? 0);

    // Average response time (0 if no leads)
    const responses = avgResponseByDate.get(date);
    metrics.responseTimeAvg.push(
      responses && responses.length > 0
        ? responses.reduce((s, v) => s + v, 0) / responses.length
        : 0
    );

    metrics.openLoops.push(loopsByDate.get(date) ?? cumLoops);
    metrics.chatEngagement.push(chatsByDate.get(date) ?? 0);

    // Derived: stress = high discipline but low energy (grinding without fuel)
    metrics.stressIndicator.push(discipline >= 6 && energy <= 4 ? 1 : 0);

    // Derived: momentum = workout + journal + 3+ habits completed
    metrics.momentumScore.push(workoutVal + journalVal + (habitsVal >= 3 ? 1 : 0));
  }

  // Time-lagged metrics: NEXT-DAY and 2-DAY revenue
  metrics.nextDayRevenue = [];
  metrics.twoDayRevenue = [];
  for (let i = 0; i < dates.length; i++) {
    const nextDate = dates[i + 1];
    const twoDate = dates[i + 2];
    metrics.nextDayRevenue.push(nextDate ? (revenueByDate.get(nextDate) ?? 0) : 0);
    metrics.twoDayRevenue.push(twoDate ? (revenueByDate.get(twoDate) ?? 0) : 0);
  }

  // Compute all pairwise correlations
  const metricNames = Object.keys(metrics);
  const correlations: Correlation[] = [];

  for (let i = 0; i < metricNames.length; i++) {
    for (let j = i + 1; j < metricNames.length; j++) {
      const a = metricNames[i];
      const b = metricNames[j];
      const r = pearson(metrics[a], metrics[b]);

      if (Math.abs(r) < 0.25) continue; // Too weak

      const strength: Correlation["strength"] =
        Math.abs(r) >= 0.6 ? "strong" : Math.abs(r) >= 0.4 ? "moderate" : "weak";

      const direction: Correlation["direction"] = r > 0 ? "positive" : "negative";

      const surprising = !isKnownChain(a, b);

      let interpretation = "";
      if (direction === "positive") {
        interpretation = `Higher ${a} correlates with higher ${b} (r=${r.toFixed(2)})`;
      } else {
        interpretation = `Higher ${a} correlates with LOWER ${b} (r=${r.toFixed(2)})`;
      }

      correlations.push({
        metricA: a,
        metricB: b,
        coefficient: Math.round(r * 100) / 100,
        strength,
        direction,
        interpretation,
        dataPoints: metrics[a].length,
        surprising,
      });
    }
  }

  // Sort by surprise value (surprising + strong first)
  correlations.sort((a, b) => {
    if (a.surprising !== b.surprising) return a.surprising ? -1 : 1;
    return Math.abs(b.coefficient) - Math.abs(a.coefficient);
  });

  // Store top surprising findings as brain memories
  const surprisingFindings = correlations.filter((c) => c.surprising && c.strength !== "weak");
  for (const finding of surprisingFindings.slice(0, 3)) {
    await brainMemory.remember(
      "hidden_correlation",
      `corr_${finding.metricA}_${finding.metricB}`,
      `HIDDEN CORRELATION: ${finding.interpretation} (${finding.strength}, n=${finding.dataPoints}). This is NOT a known causation chain — it's a data-driven discovery.`,
      "correlation-finder"
    ).catch(() => {});
  }

  return correlations.slice(0, 10);
}

/**
 * Get correlation context for system prompt.
 */
export async function getCorrelationContext(): Promise<string> {
  try {
    // v10.0.65 · soft-delete bypass fix. This pulls 3 hidden-
    // correlation rows for the system prompt every chat turn;
    // pre-fix soft-deleted correlations stayed in Nick's context.
    const memories = await prisma.brainMemory.findMany({
      where: { category: "hidden_correlation", deletedAt: null },
      orderBy: { confidence: "desc" },
      take: 3,
      select: { content: true },
    });

    if (memories.length === 0) return "";

    return [
      `── HIDDEN CORRELATIONS (data-driven discoveries) ──`,
      ...memories.map((m) => `• ${m.content.slice(0, 200)}`),
      `Use these to teach Nour about patterns he hasn't noticed.`,
    ].join("\n");
  } catch {
    return "";
  }
}
