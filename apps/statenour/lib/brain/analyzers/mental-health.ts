/**
 * Mental-health analyzer engine · 2026-06-02
 *
 * Ports the methodology of the `mental-health-analyzer` skill (mood/affect
 * trend + volatility + correlation + a multi-factor risk framework) but
 * GROUNDS it in the data statenour actually collects. No clinical
 * questionnaire (PHQ-9/GAD-7) is assumed, nothing is fabricated, and data
 * gaps are reported honestly — matching statenour's grounded-vs-fabricated
 * ethos.
 *
 * Data sources (all the operator's OWN logs, 1-10 scales per
 * lib/validators/personal-logs.ts):
 *   · PersonalDailyLog — moodScore/energyScore (1-10), sleepHours, workout, drift
 *   · BodyTracking     — stress/energy (1-10)
 *   · BrainDump        — detected `patterns` (qualitative context, surfaced not invented)
 *
 * SAFETY (verbatim port of the source skill's medical boundary, localized to
 * the US): this is NOT a medical assessment. It never diagnoses, never
 * predicts self-harm/suicide, and surfaces crisis resources (988) instead.
 * The `concern` level is an adapted, explicitly NON-clinical wellbeing signal.
 *
 * Architecture: a pure core `computeMentalHealth()` (unit-tested, no IO) +
 * a thin IO wrapper `analyzeMentalHealth()` (prisma reads → compute). The
 * agent tool (lib/ai/tools/brain.ts) lazy-imports the wrapper — same shape as
 * getEmotionalState → analyzeEmotionalArc.
 */
import { prisma } from "@/lib/prisma";
import { daysAgo, toDateString } from "@/lib/utils/datetime";

// ── pure stats helpers ────────────────────────────────────────────────
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

// ── types ──────────────────────────────────────────────────────────────
export type ConcernLevel =
  | "insufficient-data"
  | "stable"
  | "worth-attention"
  | "elevated";
type TrendLabel = "improving" | "stable" | "declining";

export interface DailyLogInput {
  logDate: Date;
  moodScore: number | null;
  energyScore: number | null;
  sleepHours: number | null;
  workoutCompleted: boolean;
  driftIncidents: number;
}
export interface BodyInput {
  date: string;
  stress: number | null;
  energy: number | null;
}
export interface JournalInput {
  patterns: string | null;
}

export interface MentalHealthAnalysis {
  window: { days: number };
  dataCompleteness: {
    dailyLogs: number;
    moodPoints: number;
    bodyEntries: number;
    journalEntries: number;
    sufficient: boolean;
    note: string;
  };
  mood: {
    avg: number;
    trend: TrendLabel;
    perMonthChange: number;
    volatilitySD: number;
    volatility: "low" | "moderate" | "high";
    lowMoodProportion: number;
  } | null;
  energy: { avg: number; trend: TrendLabel } | null;
  sleep: {
    avgHours: number;
    moodCorrelation: number | null;
    correlation: "weak" | "moderate" | "strong" | null;
  } | null;
  workout: { activeDays: number; moodLiftVsRest: number | null } | null;
  stress: { avg: number; trend: TrendLabel } | null;
  drift: { avgPerDay: number | null };
  signals: { recentJournalPatterns: string[] };
  concern: { level: ConcernLevel; points: number; factors: string[] };
  guidance: string[];
  safety: {
    canDo: string[];
    cannotDo: string[];
    crisisResources: string[];
    disclaimer: string;
  };
}

/** Medical safety boundary — ported verbatim from the source skill, US-localized. */
const SAFETY: MentalHealthAnalysis["safety"] = {
  canDo: [
    "Identify mood / energy / stress trends and patterns from logged data",
    "Surface correlations (sleep, workouts) with wellbeing",
    "Suggest non-clinical coping and track progress over time",
    "Point to professional resources when signals are elevated",
  ],
  cannotDo: [
    "Diagnose any mental-health condition",
    "Prescribe or adjust medication",
    "Predict or assess self-harm / suicide risk",
    "Replace professional care or handle an acute crisis",
  ],
  crisisResources: [
    "988 Suicide & Crisis Lifeline — call or text 988 (US, 24/7)",
    "Crisis Text Line — text HOME to 741741",
    "911 for an immediate emergency",
  ],
  disclaimer:
    "This is a grounded wellbeing signal from your own logs, NOT a medical assessment. If you're struggling, reach out to a professional or 988.",
};

/** Higher value good (mood/energy) → posIsGood=true. Stress inverts. */
function trendLabel(perMonth: number, posIsGood: boolean): TrendLabel {
  const up = perMonth >= 0.5;
  const down = perMonth <= -0.5;
  if (!up && !down) return "stable";
  if (posIsGood) return up ? "improving" : "declining";
  return up ? "declining" : "improving";
}

/**
 * Pure scoring core. Takes already-fetched, number-normalized rows and returns
 * the full grounded analysis. No IO — unit-tested directly.
 */
export function computeMentalHealth(args: {
  dailyLogs: DailyLogInput[];
  bodyRows: BodyInput[];
  journalRows: JournalInput[];
  days: number;
}): MentalHealthAnalysis {
  const { dailyLogs, bodyRows, journalRows, days } = args;

  const moodLogs = dailyLogs
    .filter((d) => d.moodScore != null)
    .sort((a, b) => a.logDate.getTime() - b.logDate.getTime());
  const moodPoints = moodLogs.length;
  const sufficient = moodPoints >= 7;

  const recentJournalPatterns = journalRows
    .map((j) => (j.patterns ?? "").trim())
    .filter((p) => p.length > 0)
    .slice(-3)
    .map((p) => (p.length > 120 ? `${p.slice(0, 117)}…` : p));

  const dataCompleteness = {
    dailyLogs: dailyLogs.length,
    moodPoints,
    bodyEntries: bodyRows.length,
    journalEntries: journalRows.length,
    sufficient,
    note: sufficient
      ? `Based on ${moodPoints} mood entries over ~${days} days.`
      : `Only ${moodPoints} mood entr${moodPoints === 1 ? "y" : "ies"} logged — need ≥7 for a reliable trend. Treat this as directional, not conclusive.`,
  };

  if (moodPoints === 0) {
    return {
      window: { days },
      dataCompleteness,
      mood: null,
      energy: null,
      sleep: null,
      workout: null,
      stress: null,
      drift: { avgPerDay: null },
      signals: { recentJournalPatterns },
      concern: {
        level: "insufficient-data",
        points: 0,
        factors: ["No mood data logged in this window."],
      },
      guidance: [
        "Log your mood daily (the 1-10 check-in) so Nick can track how you're actually doing.",
      ],
      safety: SAFETY,
    };
  }

  // ── mood ──
  const moods = moodLogs.map((d) => d.moodScore as number);
  const t0 = moodLogs[0].logDate.getTime();
  const xsDays = moodLogs.map((d) => (d.logDate.getTime() - t0) / MS_PER_DAY);
  const moodAvg = round(mean(moods));
  const perMonthChange = round(slope(xsDays, moods) * 30);
  const moodSD = round(stdev(moods));
  const volatility = moodSD > 2.5 ? "high" : moodSD >= 1.5 ? "moderate" : "low";
  const lowMoodProportion = round(
    moods.filter((m) => m <= 4).length / moods.length,
  );
  const moodTrend = trendLabel(perMonthChange, true);

  // ── energy ──
  const energyLogs = dailyLogs
    .filter((d) => d.energyScore != null)
    .sort((a, b) => a.logDate.getTime() - b.logDate.getTime());
  let energyBlock: MentalHealthAnalysis["energy"] = null;
  if (energyLogs.length) {
    const ev = energyLogs.map((d) => d.energyScore as number);
    const ex = energyLogs.map(
      (d) => (d.logDate.getTime() - energyLogs[0].logDate.getTime()) / MS_PER_DAY,
    );
    energyBlock = {
      avg: round(mean(ev)),
      trend: trendLabel(round(slope(ex, ev) * 30), true),
    };
  }

  // ── sleep + sleep↔mood correlation (same-row pairs) ──
  const sleepVals = dailyLogs
    .filter((d) => d.sleepHours != null)
    .map((d) => d.sleepHours as number);
  const sleepPairs = moodLogs.filter((d) => d.sleepHours != null);
  const r = pearson(
    sleepPairs.map((d) => d.sleepHours as number),
    sleepPairs.map((d) => d.moodScore as number),
  );
  const sleepBlock = sleepVals.length
    ? {
        avgHours: round(mean(sleepVals), 1),
        moodCorrelation: r == null ? null : round(r),
        correlation:
          r == null
            ? null
            : Math.abs(r) >= 0.5
              ? ("strong" as const)
              : Math.abs(r) >= 0.3
                ? ("moderate" as const)
                : ("weak" as const),
      }
    : null;

  // ── workout → mood lift ──
  const woDays = moodLogs.filter((d) => d.workoutCompleted);
  const restDays = moodLogs.filter((d) => !d.workoutCompleted);
  const moodLiftVsRest =
    woDays.length >= 2 && restDays.length >= 2
      ? round(
          mean(woDays.map((d) => d.moodScore as number)) -
            mean(restDays.map((d) => d.moodScore as number)),
        )
      : null;
  const workoutBlock = {
    activeDays: dailyLogs.filter((d) => d.workoutCompleted).length,
    moodLiftVsRest,
  };

  // ── stress (BodyTracking) ──
  const stressRows = bodyRows
    .filter((b) => b.stress != null)
    .sort((a, b) => a.date.localeCompare(b.date));
  let stressBlock: MentalHealthAnalysis["stress"] = null;
  let stressAvg: number | null = null;
  if (stressRows.length) {
    const sv = stressRows.map((b) => b.stress as number);
    stressAvg = round(mean(sv));
    stressBlock = {
      avg: stressAvg,
      trend: trendLabel(round(slope(stressRows.map((_, i) => i), sv) * 30), false),
    };
  }

  // ── drift ──
  const driftAvg = dailyLogs.length
    ? round(mean(dailyLogs.map((d) => d.driftIncidents)), 1)
    : null;

  // ── concern framework (adapted from the skill's risk scoring · NON-clinical) ──
  let points = 0;
  const factors: string[] = [];
  if (perMonthChange <= -1.5) {
    points += 3;
    factors.push(`Mood declining fast (${perMonthChange}/mo).`);
  } else if (perMonthChange <= -0.5) {
    points += 2;
    factors.push(`Mood trending down (${perMonthChange}/mo).`);
  }
  if (lowMoodProportion > 0.7) {
    points += 3;
    factors.push(`${Math.round(lowMoodProportion * 100)}% of days were low-mood (≤4/10).`);
  } else if (lowMoodProportion >= 0.5) {
    points += 2;
    factors.push(`${Math.round(lowMoodProportion * 100)}% of days were low-mood (≤4/10).`);
  }
  if (moodSD > 2.5) {
    points += 2;
    factors.push(`High mood volatility (SD ${moodSD}).`);
  } else if (moodSD >= 1.5) {
    points += 1;
    factors.push(`Moderate mood swings (SD ${moodSD}).`);
  }
  if (sleepBlock != null && sleepBlock.avgHours < 6 && perMonthChange < 0) {
    points += 2;
    factors.push(`Short sleep (${sleepBlock.avgHours}h avg) alongside a falling mood.`);
  }
  if (stressAvg != null && stressAvg >= 7) {
    points += 2;
    factors.push(`Sustained high stress (${stressAvg}/10).`);
  } else if (stressAvg != null && stressAvg >= 5) {
    points += 1;
    factors.push(`Elevated stress (${stressAvg}/10).`);
  }
  if (driftAvg != null && driftAvg >= 5) {
    points += 1;
    factors.push(`High daily drift (${driftAvg} incidents/day).`);
  }

  let level: ConcernLevel;
  if (!sufficient) level = "insufficient-data";
  else if (points >= 7) level = "elevated";
  else if (points >= 3) level = "worth-attention";
  else level = "stable";
  if (factors.length === 0) {
    factors.push("No elevated wellbeing signals in the logged data.");
  }

  // ── grounded guidance (derived from the metrics — never invented) ──
  const guidance: string[] = [];
  if (level === "elevated") {
    guidance.push(
      "This is a pattern signal, not a diagnosis — if you're struggling, talk to someone or reach 988. The factors below are what your own data is showing.",
    );
  }
  if (moodLiftVsRest != null && moodLiftVsRest >= 1) {
    guidance.push(
      `Workout days run +${moodLiftVsRest} mood vs rest days — your strongest logged lever. You trained ${workoutBlock.activeDays} day(s) this window.`,
    );
  }
  if (r != null && r >= 0.3) {
    guidance.push(
      `Sleep tracks with mood (r=${round(r)}). Protecting sleep looks like protecting mood.`,
    );
  }
  if (perMonthChange >= 0.5) {
    guidance.push(
      `Mood is improving (+${perMonthChange}/mo) — whatever you changed recently is working.`,
    );
  }
  if (!sufficient) {
    guidance.push("Log mood for at least 7 days to unlock a reliable trend.");
  }
  if (guidance.length === 0) {
    guidance.push(
      "Mood is stable. Keep the daily check-in going so Nick can catch shifts early.",
    );
  }

  return {
    window: { days },
    dataCompleteness,
    mood: {
      avg: moodAvg,
      trend: moodTrend,
      perMonthChange,
      volatilitySD: moodSD,
      volatility,
      lowMoodProportion,
    },
    energy: energyBlock,
    sleep: sleepBlock,
    workout: workoutBlock,
    stress: stressBlock,
    drift: { avgPerDay: driftAvg },
    signals: { recentJournalPatterns },
    concern: { level, points, factors },
    guidance,
    safety: SAFETY,
  };
}

/**
 * IO wrapper — reads the operator's own logs and runs the pure core.
 * Fire-and-forget safe: each read degrades to [] on error so the tool never
 * throws (mirrors the other brain-tool readers).
 */
export async function analyzeMentalHealth({
  days = 30,
}: { days?: number } = {}): Promise<MentalHealthAnalysis> {
  const since = daysAgo(days);
  const sinceStr = toDateString(since);
  const [dailyRaw, bodyRaw, journalRaw] = await Promise.all([
    prisma.personalDailyLog
      .findMany({
        where: { logDate: { gte: since } },
        orderBy: { logDate: "asc" },
        select: {
          logDate: true,
          moodScore: true,
          energyScore: true,
          sleepHours: true,
          workoutCompleted: true,
          driftIncidents: true,
        },
      })
      .catch((): never[] => []),
    prisma.bodyTracking
      .findMany({
        where: { date: { gte: sinceStr } },
        orderBy: { date: "asc" },
        select: { date: true, stress: true, energy: true },
      })
      .catch((): never[] => []),
    prisma.brainDump
      .findMany({
        where: { date: { gte: sinceStr }, deletedAt: null },
        orderBy: { date: "asc" },
        select: { patterns: true },
      })
      .catch((): never[] => []),
  ]);

  const dailyLogs: DailyLogInput[] = dailyRaw.map((d) => ({
    logDate: d.logDate,
    moodScore: d.moodScore,
    energyScore: d.energyScore,
    sleepHours: d.sleepHours == null ? null : Number(d.sleepHours),
    workoutCompleted: d.workoutCompleted,
    driftIncidents: d.driftIncidents,
  }));
  const bodyRows: BodyInput[] = bodyRaw.map((b) => ({
    date: b.date,
    stress: b.stress,
    energy: b.energy,
  }));
  const journalRows: JournalInput[] = journalRaw.map((j) => ({
    patterns: j.patterns,
  }));

  return computeMentalHealth({ dailyLogs, bodyRows, journalRows, days });
}
