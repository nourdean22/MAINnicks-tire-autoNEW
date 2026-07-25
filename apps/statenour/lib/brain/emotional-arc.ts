/**
 * Emotional Arc Tracker
 *
 * Goes beyond single-word mood labels to track emotional TRAJECTORIES:
 * - Stress building over 3 days
 * - Relief after a big sale
 * - Frustration cycling with overwork
 * - Correlates emotional state with decision quality
 *
 * Uses conversation digests, brain dumps, and daily scores to build a multi-day arc.
 */

import { prisma } from "@/lib/prisma";
// v10.0.64 · AgentTrace coverage.
import { makeTracedAiChat } from "@/lib/ai/traced-aichat";
const aiChat = makeTracedAiChat("emotional-arc");
import { extractJsonObject } from "@/lib/ai/extract-structured";
import { daysAgo, today } from "@/lib/utils/datetime";
import { recentScoreSnapshots } from "@/lib/brain/legacy-shims";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

export interface EmotionalArc {
  period: string;
  trajectory: "rising" | "falling" | "volatile" | "stable";
  dominantState: string;
  triggers: string[];
  businessImpact: string | null;
  decisionRisk: string | null;
  // Enhanced: pure-math emotional metrics
  energyTrend: number; // slope: positive = rising, negative = falling
  moodDistribution: Record<string, number>; // mood → count over 7d
  volatilityScore: number; // 0-100: how much energy bounces day-to-day
  stressDays: number; // days with energy ≤ 3 AND discipline ≤ 4
  recoveryPattern: string | null; // what happens after a bad day
  interventionRecommendation: string | null; // what to do RIGHT NOW
  copingEffectiveness: number; // 0-100: how well bad days are handled
}

/**
 * Analyze emotional trajectory over the last 7 days.
 */
export async function analyzeEmotionalArc(): Promise<EmotionalArc | null> {
  // v10.0.55 · scores via legacy-shim.
  const [scores, dumps, digests, decisions] = await Promise.all([
    recentScoreSnapshots(7),
    prisma.brainDump.findMany({
      where: { createdAt: { gte: daysAgo(7) }, deletedAt: null },
      orderBy: { createdAt: "asc" },
      take: 5,
      select: { date: true, rawThoughts: true, summary: true },
    }),
    prisma.auditEvent.findMany({
      where: {
        eventType: "conversation_digest",
        createdAt: { gte: daysAgo(7) },
      },
      orderBy: { createdAt: "asc" },
      take: 10,
      select: { payload: true },
    }),
    prisma.masteryDecision.findMany({
      where: { createdAt: { gte: daysAgo(7) }, deletedAt: null },
      select: { title: true, grade: true, date: true },
    }),
  ]);

  // Build emotional signal timeline
  const signals: string[] = [];

  for (const s of scores) {
    signals.push(
      `${s.date}: Score ${s.overallScore}/10, Energy ${s.energyLevel}/10, Mood: ${s.mood || "unlogged"}`
    );
  }

  for (const d of dumps) {
    const text = (d.summary || d.rawThoughts || "").slice(0, 200);
    signals.push(`${d.date} brain dump: "${text}"`);
  }

  for (const dg of digests) {
    const p = dg.payload as any;
    if (p?.emotionalArc) {
      signals.push(
        `Conversation mood: ${p.emotionalArc.start} → ${p.emotionalArc.end} (${p.emotionalArc.trajectory})`
      );
    }
  }

  for (const dec of decisions) {
    signals.push(`Decision: "${dec.title}" — grade ${dec.grade || "?"}`);
  }

  // ── Pure-math emotional analysis (no AI dependency) ──

  // Energy trend: linear regression slope over 7 days
  let energyTrend = 0;
  const energyValues = scores.map((s, i) => ({ x: i, y: s.energyLevel ?? 5 }));
  if (energyValues.length >= 3) {
    const n = energyValues.length;
    const sumX = energyValues.reduce((s, v) => s + v.x, 0);
    const sumY = energyValues.reduce((s, v) => s + v.y, 0);
    const sumXY = energyValues.reduce((s, v) => s + v.x * v.y, 0);
    const sumX2 = energyValues.reduce((s, v) => s + v.x * v.x, 0);
    const denom = n * sumX2 - sumX * sumX;
    if (denom !== 0) energyTrend = Math.round(((n * sumXY - sumX * sumY) / denom) * 100) / 100;
  }

  // Mood distribution
  const moodDistribution: Record<string, number> = {};
  for (const s of scores) {
    const mood = s.mood || "unlogged";
    moodDistribution[mood] = (moodDistribution[mood] ?? 0) + 1;
  }

  // Volatility: standard deviation of energy scores
  let volatilityScore = 0;
  if (energyValues.length >= 3) {
    const mean = energyValues.reduce((s, v) => s + v.y, 0) / energyValues.length;
    const variance = energyValues.reduce((s, v) => s + (v.y - mean) ** 2, 0) / energyValues.length;
    const stdDev = Math.sqrt(variance);
    volatilityScore = Math.min(100, Math.round(stdDev * 25)); // Scale: 0-4 stddev → 0-100
  }

  // Stress days: energy ≤ 3
  const stressDays = scores.filter(s => (s.energyLevel ?? 5) <= 3).length;

  // Recovery pattern: what happens the day AFTER a bad day?
  let recoveryPattern: string | null = null;
  const badDays: number[] = [];
  const nextDayScores: number[] = [];
  for (let i = 0; i < scores.length - 1; i++) {
    if ((scores[i].energyLevel ?? 5) <= 3) {
      badDays.push(i);
      nextDayScores.push(scores[i + 1].energyLevel ?? 5);
    }
  }
  if (nextDayScores.length >= 2) {
    const avgRecovery = nextDayScores.reduce((s, v) => s + v, 0) / nextDayScores.length;
    if (avgRecovery >= 6) recoveryPattern = `Strong recovery — avg ${avgRecovery.toFixed(1)} energy after bad days. Resilience is high.`;
    else if (avgRecovery >= 4) recoveryPattern = `Moderate recovery (${avgRecovery.toFixed(1)} avg after bad days). Takes a day to bounce back.`;
    else recoveryPattern = `Weak recovery (${avgRecovery.toFixed(1)} avg). Bad days cascade into multi-day dips. Need active intervention.`;
  }

  // Coping effectiveness: how quickly does energy return to baseline after a dip?
  const baseline = energyValues.length > 0 ? energyValues.reduce((s, v) => s + v.y, 0) / energyValues.length : 5;
  let copingEffectiveness = 50; // default
  if (nextDayScores.length >= 2) {
    const recoveryRate = nextDayScores.filter(v => v >= baseline * 0.8).length / nextDayScores.length;
    copingEffectiveness = Math.round(recoveryRate * 100);
  }

  // Intervention recommendation based on math
  let interventionRecommendation: string | null = null;
  if (energyTrend < -0.5 && stressDays >= 2) {
    interventionRecommendation = "FALLING energy + multiple stress days. Reduce commitments TODAY. Do NOT start new projects. Focus on body (workout, sleep, hydration).";
  } else if (volatilityScore > 60) {
    interventionRecommendation = "HIGH volatility — energy is bouncing wildly. Stabilize: consistent sleep time, no caffeine after 2pm, morning routine non-negotiable.";
  } else if (stressDays >= 3) {
    interventionRecommendation = `${stressDays}/7 stress days. This is unsustainable. Cancel one commitment, do one easy win, protect tonight's sleep.`;
  } else if (energyTrend > 0.3) {
    interventionRecommendation = "Energy is RISING. Good window for hard decisions and challenging work. Push now while momentum is here.";
  }

  // Compute math-based trajectory
  const mathTrajectory = energyTrend > 0.3 ? "rising" as const
    : energyTrend < -0.3 ? "falling" as const
    : volatilityScore > 50 ? "volatile" as const
    : "stable" as const;

  const dominantMood = Object.entries(moodDistribution).sort(([, a], [, b]) => b - a)[0]?.[0] ?? "unlogged";

  if (signals.length < 3) {
    // Not enough data for AI — return math-only analysis
    const arc: EmotionalArc = {
      period: `${toDateStr(daysAgo(7))} to ${today()}`,
      trajectory: mathTrajectory,
      dominantState: dominantMood,
      triggers: [],
      businessImpact: stressDays >= 3 ? `${stressDays} stress days likely slowed response times and follow-up quality` : null,
      decisionRisk: energyTrend < -0.5 ? "Depleted state — delay irreversible decisions" : null,
      energyTrend,
      moodDistribution,
      volatilityScore,
      stressDays,
      recoveryPattern,
      interventionRecommendation,
      copingEffectiveness,
    };
    return arc;
  }

  const result = await aiChat(
    [
      {
        role: "system",
        content: `You are the Emotional Arc Tracker for NOUR OS. Analyze 7 days of emotional signals to map Nour's internal trajectory.

Return ONLY JSON:
{
  "trajectory": "rising|falling|volatile|stable",
  "dominantState": "focused|stressed|energized|depleted|frustrated|confident|scattered",
  "triggers": ["specific events or patterns causing emotional shifts"],
  "businessImpact": "How this emotional state is affecting business decisions and output, or null",
  "decisionRisk": "If current state poses a risk to decision quality, describe it. Otherwise null."
}

GOOD analysis:
- trajectory: "falling" — "Energy declining 3 straight days (7→5→3), brain dumps increasingly mention being overwhelmed, conversation mood shifted from 'energized' to 'frustrated'"
- decisionRisk: "Depleted state correlates with impulsive decisions — last 2 choices in this state graded C-. Delay high-stakes decisions 24h."
- businessImpact: "Stress-driven avoidance: 0 estimate follow-ups in 3 days during this arc. Revenue leak ~$800"

BAD analysis:
- "Things seem okay" (useless)
- "Maybe stressed?" (no evidence)`,
      },
      { role: "user", content: signals.join("\n") },
    ],
    "reason"
  );

   
  const extracted = extractJsonObject<any>(result.content);
  if (!extracted.ok) return null;

  try {
    const parsed = extracted.value;
    const arc: EmotionalArc = {
      period: `${toDateStr(daysAgo(7))} to ${today()}`,
      trajectory: parsed.trajectory || mathTrajectory,
      dominantState: parsed.dominantState || dominantMood,
      triggers: parsed.triggers || [],
      businessImpact: parsed.businessImpact || (stressDays >= 3 ? `${stressDays} stress days likely impacted output` : null),
      decisionRisk: parsed.decisionRisk || (energyTrend < -0.5 ? "Depleted — delay big decisions" : null),
      energyTrend,
      moodDistribution,
      volatilityScore,
      stressDays,
      recoveryPattern,
      interventionRecommendation,
      copingEffectiveness,
    };

    // Store as brain memory
    await prisma.brainMemory
      .upsert({
        where: {
          category_key: {
            category: BRAIN_CATEGORIES.EMOTIONAL_ARC,
            key: `arc_${today()}`,
          },
        },
        create: {
          category: BRAIN_CATEGORIES.EMOTIONAL_ARC,
          key: `arc_${today()}`,
          content: `${arc.trajectory} | ${arc.dominantState} | Triggers: ${arc.triggers.join(", ")}${arc.decisionRisk ? ` | RISK: ${arc.decisionRisk}` : ""}`,
          confidence: 0.7,
          source: "emotional_arc_tracker",
        },
        update: {
          content: `${arc.trajectory} | ${arc.dominantState} | Triggers: ${arc.triggers.join(", ")}${arc.decisionRisk ? ` | RISK: ${arc.decisionRisk}` : ""}`,
          confidence: 0.7,
        },
      })
      .catch(() => {});

    return arc;
  } catch {
    return null;
  }
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Get emotional arc for system prompt.
 */
export async function getEmotionalArcContext(): Promise<string> {
  const arc = await prisma.brainMemory
    .findFirst({
      where: { category: BRAIN_CATEGORIES.EMOTIONAL_ARC },
      orderBy: { createdAt: "desc" },
      select: { content: true },
    })
    .catch(() => null);

  if (!arc) return "";

  return [
    `── EMOTIONAL ARC (7d) ──`,
    arc.content.slice(0, 200),
    `Energy trend: ${arc.content.includes("rising") ? "↑" : arc.content.includes("falling") ? "↓" : "→"}`,
    `Use this to calibrate response tone. If falling/volatile, be gentler but more directive.`,
  ].join("\n");
}
