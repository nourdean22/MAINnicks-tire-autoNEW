/**
 * Composure / control analyzer · 2026-06-20
 *
 * Scores the operator's emotional regulation and strategic
 * self-presentation. Architecture mirrors mental-health.ts exactly:
 * pure core computeComposure() (unit-tested, no IO) + thin IO wrapper
 * analyzeComposure() (prisma reads → compute).
 *
 * Scoring uses the P0WER Iota framework: emotional detachment,
 * neutralizing triggers, reprogramming responses, projecting dominant
 * body language, assertive communication.
 */

import { prisma } from "@/lib/prisma";
import { daysAgo } from "@/lib/utils/datetime";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

// ── helpers ───────────────────────────────────────────────────────────
function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length;
  return Math.sqrt(variance);
}
function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}
function round(n: number, d = 2): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

// ── types ─────────────────────────────────────────────────────────────
export interface DailyLogInput {
  date: Date;
  moodScore: number | null;
  energyScore: number | null;
  driftIncidents: number;
}

export interface BrainDumpInput {
  createdAt: Date;
  rawThoughts: string;
  tags: string[] | null;
}

export interface DecisionInput {
  createdAt: Date;
  grade: string | null;
}

export interface EmotionalArcInput {
  trajectory: "improving" | "stable" | "declining" | "volatile";
  recoveryPattern: "fast" | "moderate" | "slow" | "none";
  volatility: number;
}

export interface ComposureAnalysis {
  window: { days: number };
  composureScore: number;
  signals: {
    moodStability: number;
    driftControl: number;
    decisionQualityUnderStress: number;
    recoverySpeed: number;
    triggerManagement: number;
  };
  patterns: {
    stressTriggers: string[];
    composureBreakdowns: { date: string; trigger: string; recovery: string }[];
  };
  guidance: string[];
}

// ── stress trigger keywords ───────────────────────────────────────────
const STRESS_KEYWORDS = [
  "angry", "frustrated", "overwhelmed", "stress", "anxious", "panic",
  "exhausted", "burnt out", "fed up", "losing it", "can't take",
  "pressure", "deadline", "conflict", "fight", "argument",
];

const TRIGGER_PATTERNS = [
  { pattern: /\b(angry|furious|rage|pissed)\b/i, trigger: "Anger" },
  { pattern: /\b(anxious|worried|nervous|panic)\b/i, trigger: "Anxiety" },
  { pattern: /\b(overwhelmed|exhausted|burnt out|drained)\b/i, trigger: "Exhaustion" },
  { pattern: /\b(frustrated|fed up|losing it|can't take)\b/i, trigger: "Frustration" },
  { pattern: /\b(conflict|fight|argument|confrontation)\b/i, trigger: "Conflict" },
  { pattern: /\b(deadline|pressure|rush|urgent)\b/i, trigger: "Time pressure" },
];

// ── pure core ─────────────────────────────────────────────────────────

/**
 * Pure scoring core. Takes already-fetched, normalized rows and returns
 * the full composure analysis. No IO — unit-tested directly.
 */
export function computeComposure(args: {
  dailyLogs: DailyLogInput[];
  brainDumps: BrainDumpInput[];
  decisions: DecisionInput[];
  emotionalArc: EmotionalArcInput | null;
  days: number;
}): ComposureAnalysis {
  const { dailyLogs, brainDumps, decisions, emotionalArc, days } = args;

  // ── mood stability (inverse of volatility) ──
  const moodScores = dailyLogs
    .filter((d) => d.moodScore != null)
    .map((d) => d.moodScore as number);
  const moodVolatility = stdev(moodScores);
  const moodStability = clamp(100 - moodVolatility * 20);

  // ── drift control (inverse of drift incidents) ──
  let driftCount = 0;
  for (const d of dailyLogs) {
    driftCount += d.driftIncidents;
  }
  const driftRate = dailyLogs.length > 0 ? driftCount / dailyLogs.length : 0;
  const driftControl = clamp(100 - driftRate * 25);

  // ── decision quality under stress ──
  const lowEnergyDays = new Set(
    dailyLogs
      .filter((d) => d.energyScore != null && (d.energyScore as number) < 4)
      .map((d) => d.date.toISOString().slice(0, 10)),
  );
  const stressedDecisions = decisions.filter(
    (d) => lowEnergyDays.has(d.createdAt.toISOString().slice(0, 10)),
  );
  const gradeMap: Record<string, number> = { A: 100, B: 80, C: 60, D: 40, F: 20 };
  const stressedGrades = stressedDecisions
    .filter((d) => d.grade != null)
    .map((d) => gradeMap[d.grade as string] ?? 50);
  const decisionQualityUnderStress = stressedGrades.length > 0
    ? clamp(mean(stressedGrades))
    : 75; // neutral default when no stressed decisions

  // ── recovery speed (from emotional arc) ──
  const recoveryMap: Record<string, number> = { fast: 95, moderate: 70, slow: 40, none: 20 };
  const recoverySpeed = emotionalArc
    ? recoveryMap[emotionalArc.recoveryPattern] ?? 60
    : 60;

  // ── trigger management (journal pattern analysis) ──
  const triggerCounts: Record<string, number> = {};
  const breakdowns: { date: string; trigger: string; recovery: string }[] = [];

  for (const dump of brainDumps) {
    const text = dump.rawThoughts.toLowerCase();
    for (const { pattern, trigger } of TRIGGER_PATTERNS) {
      if (pattern.test(text)) {
        triggerCounts[trigger] = (triggerCounts[trigger] ?? 0) + 1;
        if (breakdowns.length < 5) {
          breakdowns.push({
            date: dump.createdAt.toISOString().slice(0, 10),
            trigger,
            recovery: "See journal entry for recovery details",
          });
        }
      }
    }
  }

  const totalTriggers = Object.values(triggerCounts).reduce((a, b) => a + b, 0);
  const triggerManagement = clamp(100 - totalTriggers * 10);

  // ── composure score (weighted average) ──
  const composureScore = round(
    moodStability * 0.25 +
    driftControl * 0.20 +
    decisionQualityUnderStress * 0.25 +
    recoverySpeed * 0.15 +
    triggerManagement * 0.15,
  );

  // ── stress triggers (sorted by frequency) ──
  const stressTriggers = Object.entries(triggerCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([t]) => t);

  // ── guidance ──
  const guidance: string[] = [];
  if (moodStability < 60) {
    guidance.push("Mood volatility is high. Practice the 3-second pause between trigger and response.");
  }
  if (driftControl < 60) {
    guidance.push("Drift incidents are frequent. Identify your top distraction and block it during deep work.");
  }
  if (decisionQualityUnderStress < 60) {
    guidance.push("Decision quality drops under stress. Delay non-urgent decisions on low-energy days.");
  }
  if (recoverySpeed < 50) {
    guidance.push("Emotional recovery is slow. Build a 5-minute reset routine (cold water, breathing, walk).");
  }
  if (stressTriggers.includes("Anger")) {
    guidance.push("Anger is your most frequent trigger. Pre-plan a neutral response for your top anger situation.");
  }
  if (stressTriggers.includes("Exhaustion")) {
    guidance.push("Exhaustion is triggering composure breakdowns. Protect sleep — composure starts with rest.");
  }
  if (composureScore >= 80) {
    guidance.push("Composure is strong. You're projecting calm dominance — maintain the practice.");
  }
  if (guidance.length === 0) {
    guidance.push("Composure signals are balanced. Keep monitoring your triggers and recovery patterns.");
  }

  return {
    window: { days },
    composureScore,
    signals: { moodStability: round(moodStability), driftControl: round(driftControl), decisionQualityUnderStress: round(decisionQualityUnderStress), recoverySpeed: round(recoverySpeed), triggerManagement: round(triggerManagement) },
    patterns: { stressTriggers, composureBreakdowns: breakdowns },
    guidance,
  };
}

// ── IO wrapper ────────────────────────────────────────────────────────

export async function analyzeComposure({
  days = 14,
}: { days?: number } = {}): Promise<ComposureAnalysis> {
  const since = daysAgo(days);

  const [dailyLogs, brainDumps, decisions, emotionalArcRows] =
    await Promise.all([
      prisma.personalDailyLog.findMany({
        where: { logDate: { gte: since } },
        select: { logDate: true, moodScore: true, energyScore: true, driftIncidents: true },
      }).catch((): never[] => []),
      prisma.brainDump.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true, rawThoughts: true },
        take: 50,
      }).catch((): never[] => []),
      prisma.masteryDecision.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true, grade: true },
        take: 50,
      }).catch((): never[] => []),
      prisma.brainMemory.findMany({
        where: { category: "emotional_arc", deletedAt: null },
        select: { metadata: true },
        take: 1,
        orderBy: { lastSeen: "desc" },
      }).catch((): never[] => []),
    ]);

  const logInputs: DailyLogInput[] = (dailyLogs as unknown[]).map((d) => {
    const r = d as Record<string, unknown>;
    return {
      date: new Date(r.logDate as string),
      moodScore: r.moodScore != null ? Number(r.moodScore) : null,
      energyScore: r.energyScore != null ? Number(r.energyScore) : null,
      driftIncidents: Number(r.driftIncidents ?? 0),
    };
  });

  const dumpInputs: BrainDumpInput[] = (brainDumps as unknown[]).map((d) => {
    const r = d as Record<string, unknown>;
    return {
      createdAt: new Date(r.createdAt as string),
      rawThoughts: String(r.rawThoughts ?? ""),
      tags: null,
    };
  });

  const decisionInputs: DecisionInput[] = (decisions as unknown[]).map((d) => {
    const r = d as Record<string, unknown>;
    return {
      createdAt: new Date(r.createdAt as string),
      grade: r.grade ? String(r.grade) : null,
    };
  });

  let emotionalArc: EmotionalArcInput | null = null;
  if (emotionalArcRows.length > 0) {
    const meta = ((emotionalArcRows[0] as Record<string, unknown>).metadata ?? {}) as Record<string, unknown>;
    emotionalArc = {
      trajectory: (meta.trajectory as EmotionalArcInput["trajectory"]) ?? "stable",
      recoveryPattern: (meta.recoveryPattern as EmotionalArcInput["recoveryPattern"]) ?? "moderate",
      volatility: typeof meta.volatility === "number" ? meta.volatility : 0,
    };
  }

  return computeComposure({
    dailyLogs: logInputs,
    brainDumps: dumpInputs,
    decisions: decisionInputs,
    emotionalArc,
    days,
  });
}
