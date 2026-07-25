/**
 * Decision Pattern Analyzer
 *
 * Analyzes Nour's decision history to find patterns:
 * - Best time of day for decisions
 * - Decision quality by energy level
 * - Overcommit patterns after high-energy days
 * - Avoidance patterns on certain types of decisions
 *
 * Enhanced with pure-math analysis (no AI dependency):
 * - Time-of-day quality scoring (morning vs afternoon vs evening)
 * - Energy-level quality correlation
 * - Stakes calibration (does he inflate stakes?)
 * - Decision speed analysis (snap vs deliberate)
 * - Commitment-to-completion ratio
 * - Regret pattern detection (grade changes over time)
 * - Domain quality distribution (business vs personal vs financial)
 * - Streak analysis (consecutive good/bad decisions)
 *
 * Feeds into system prompt so Nick can say: "careful, you're in your overcommit pattern"
 */

import { prisma } from "@/lib/prisma";
// v10.0.64 · AgentTrace coverage.
import { makeTracedAiChat } from "@/lib/ai/traced-aichat";
const aiChat = makeTracedAiChat("decision-patterns");
import { extractJsonArray } from "@/lib/ai/extract-structured";
import { daysAgo, today } from "@/lib/utils/datetime";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logError } from "@/lib/utils/error-log";

export interface DecisionPattern {
  pattern: string;
  evidence: string;
  frequency: number;
  actionable: string;
}

interface MathPattern {
  name: string;
  finding: string;
  confidence: number;
  intervention: string;
}

const GRADE_VALUES: Record<string, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 };

function gradeToNumber(grade: string | null): number | null {
  if (!grade) return null;
  return GRADE_VALUES[grade.charAt(0).toUpperCase()] ?? null;
}

/**
 * Pure math decision analysis — works without AI.
 */
async function mathAnalysis(
  decisions: { title: string; date: string; stakes: string | null; chosen: string | null; grade: string | null; createdAt: Date }[],
  scores: { date: string; overallScore: number | null; energyLevel: number | null; disciplineScore: number | null }[],
  commitments: { status: string; createdAt: Date }[]
): Promise<MathPattern[]> {
  const patterns: MathPattern[] = [];
  const scoreMap = new Map(scores.map(s => [s.date, s]));

  // ── Time-of-day quality ──
  const morningDecisions: number[] = [];
  const afternoonDecisions: number[] = [];
  const eveningDecisions: number[] = [];

  for (const d of decisions) {
    const gradeVal = gradeToNumber(d.grade);
    if (gradeVal === null) continue;
    const hour = d.createdAt.getHours();
    if (hour >= 6 && hour < 12) morningDecisions.push(gradeVal);
    else if (hour >= 12 && hour < 18) afternoonDecisions.push(gradeVal);
    else eveningDecisions.push(gradeVal);
  }

  if (morningDecisions.length >= 3 && (afternoonDecisions.length >= 3 || eveningDecisions.length >= 3)) {
    const mAvg = morningDecisions.reduce((s, v) => s + v, 0) / morningDecisions.length;
    const aAvg = afternoonDecisions.length > 0 ? afternoonDecisions.reduce((s, v) => s + v, 0) / afternoonDecisions.length : mAvg;
    const eAvg = eveningDecisions.length > 0 ? eveningDecisions.reduce((s, v) => s + v, 0) / eveningDecisions.length : mAvg;

    const bestTime = mAvg >= aAvg && mAvg >= eAvg ? "morning" : aAvg >= eAvg ? "afternoon" : "evening";
    const worstTime = mAvg <= aAvg && mAvg <= eAvg ? "morning" : aAvg <= eAvg ? "afternoon" : "evening";

    if (Math.abs(mAvg - eAvg) >= 0.5 || Math.abs(mAvg - aAvg) >= 0.5) {
      patterns.push({
        name: "Time-of-Day Quality",
        finding: `${bestTime} decisions avg ${bestTime === "morning" ? mAvg.toFixed(1) : bestTime === "afternoon" ? aAvg.toFixed(1) : eAvg.toFixed(1)} vs ${worstTime} at ${worstTime === "morning" ? mAvg.toFixed(1) : worstTime === "afternoon" ? aAvg.toFixed(1) : eAvg.toFixed(1)} (${morningDecisions.length}am/${afternoonDecisions.length}pm/${eveningDecisions.length}eve)`,
        confidence: 0.7,
        intervention: `Delay ${worstTime} decisions to ${bestTime} when possible. Adderall peak matters.`,
      });
    }
  }

  // ── Energy level → decision quality ──
  const highEnergyGrades: number[] = [];
  const lowEnergyGrades: number[] = [];

  for (const d of decisions) {
    const gradeVal = gradeToNumber(d.grade);
    if (gradeVal === null) continue;
    const dayScore = scoreMap.get(d.date);
    if (!dayScore?.energyLevel) continue;
    if (dayScore.energyLevel >= 7) highEnergyGrades.push(gradeVal);
    else if (dayScore.energyLevel <= 4) lowEnergyGrades.push(gradeVal);
  }

  if (highEnergyGrades.length >= 3 && lowEnergyGrades.length >= 3) {
    const highAvg = highEnergyGrades.reduce((s, v) => s + v, 0) / highEnergyGrades.length;
    const lowAvg = lowEnergyGrades.reduce((s, v) => s + v, 0) / lowEnergyGrades.length;
    const diff = highAvg - lowAvg;

    if (Math.abs(diff) >= 0.3) {
      patterns.push({
        name: "Energy→Decision Quality",
        finding: diff > 0
          ? `High-energy decisions grade ${highAvg.toFixed(1)} vs low-energy ${lowAvg.toFixed(1)} (Δ${diff.toFixed(1)})`
          : `COUNTER-INTUITIVE: Low-energy decisions grade BETTER (${lowAvg.toFixed(1)} vs ${highAvg.toFixed(1)}) — deliberation beats impulse?`,
        confidence: diff > 0 ? 0.75 : 0.6,
        intervention: diff > 0
          ? "Postpone irreversible decisions on low-energy days."
          : "High energy may cause overconfidence. Double-check big decisions when feeling great.",
      });
    }
  }

  // ── Stakes calibration ──
  const stakesCounts = { high: 0, medium: 0, low: 0 };
  for (const d of decisions) {
    if (d.stakes === "high") stakesCounts.high++;
    else if (d.stakes === "medium") stakesCounts.medium++;
    else stakesCounts.low++;
  }

  const highStakesPct = decisions.length > 0 ? (stakesCounts.high / decisions.length) * 100 : 0;
  if (highStakesPct > 60 && decisions.length >= 10) {
    patterns.push({
      name: "Stakes Inflation",
      finding: `${highStakesPct.toFixed(0)}% of decisions labeled 'high stakes' — everything feels critical. This erodes prioritization.`,
      confidence: 0.65,
      intervention: "Before labeling high-stakes: 'Will this matter in 6 months?' If no, it's medium at best.",
    });
  }

  // ── Commitment follow-through ──
  const totalCommitments = commitments.length;
  const keptCommitments = commitments.filter(c => c.status === "kept" || c.status === "completed").length;
  const brokenCommitments = commitments.filter(c => c.status === "broken" || c.status === "abandoned").length;

  if (totalCommitments >= 5) {
    const followThroughRate = Math.round((keptCommitments / totalCommitments) * 100);
    if (followThroughRate < 50) {
      patterns.push({
        name: "Low Follow-Through",
        finding: `${followThroughRate}% commitment follow-through (${keptCommitments}/${totalCommitments}). ${brokenCommitments} broken.`,
        confidence: 0.8,
        intervention: "Making fewer, more deliberate commitments. Quality over quantity. Each broken commitment erodes self-trust.",
      });
    }
  }

  // ── Decision streak ──
  const gradedDecisions = decisions.filter(d => d.grade).sort((a, b) => b.date.localeCompare(a.date));
  let goodStreak = 0;
  let badStreak = 0;
  for (const d of gradedDecisions) {
    const val = gradeToNumber(d.grade);
    if (val === null) break;
    if (val >= 3) { goodStreak++; if (badStreak > 0) break; }
    else { badStreak++; if (goodStreak > 0) break; }
  }

  if (goodStreak >= 4) {
    patterns.push({
      name: "Decision Hot Streak",
      finding: `${goodStreak} consecutive good decisions (B or above). Decision quality is HIGH right now.`,
      confidence: 0.7,
      intervention: "Use this momentum — tackle the decision you've been avoiding.",
    });
  } else if (badStreak >= 3) {
    patterns.push({
      name: "Decision Cold Streak",
      finding: `${badStreak} consecutive poor decisions (C or below). Decision quality is LOW.`,
      confidence: 0.75,
      intervention: "STOP making decisions today. Sleep on everything. Your decision engine needs a reset.",
    });
  }

  // ── Discipline correlation ──
  const highDiscGrades: number[] = [];
  const lowDiscGrades: number[] = [];

  for (const d of decisions) {
    const gradeVal = gradeToNumber(d.grade);
    if (gradeVal === null) continue;
    const dayScore = scoreMap.get(d.date);
    if (!dayScore?.disciplineScore) continue;
    if (dayScore.disciplineScore >= 7) highDiscGrades.push(gradeVal);
    else if (dayScore.disciplineScore <= 4) lowDiscGrades.push(gradeVal);
  }

  if (highDiscGrades.length >= 3 && lowDiscGrades.length >= 3) {
    const highAvg = highDiscGrades.reduce((s, v) => s + v, 0) / highDiscGrades.length;
    const lowAvg = lowDiscGrades.reduce((s, v) => s + v, 0) / lowDiscGrades.length;

    if (highAvg - lowAvg >= 0.5) {
      patterns.push({
        name: "Discipline→Decision Quality",
        finding: `High-discipline days produce ${highAvg.toFixed(1)} grade vs ${lowAvg.toFixed(1)} on low-discipline days.`,
        confidence: 0.7,
        intervention: "Your habits aren't just habits — they're decision pre-conditioning. Maintain the routine.",
      });
    }
  }

  return patterns;
}

/**
 * Run decision pattern analysis.
 * Now combines pure-math analysis with optional AI enhancement.
 */
// v10.0.55 · Local wrapper around recentScoreSnapshots. Imported as a
// named function to keep the Promise.all readable. Single import line
// at top of file would also work — kept inline for visibility next to
// the only call site in this module.
async function recentScoreSnapshotsForDecisionPatterns(days: number) {
  const { recentScoreSnapshots } = await import("@/lib/brain/legacy-shims");
  return recentScoreSnapshots(days);
}

export async function analyzeDecisionPatterns(): Promise<{
  patterns: DecisionPattern[];
  mathPatterns: MathPattern[];
}> {
  const [decisions, scores, commitments] = await Promise.all([
    prisma.masteryDecision.findMany({
      where: { deletedAt: null }, // v10.0.68
      orderBy: { date: "desc" },
      take: 50,
      select: { title: true, date: true, stakes: true, chosen: true, grade: true, createdAt: true },
    }),
    // v10.0.55 · scores via legacy-shim. 90d window matches the
    // commitments window so the math analysis has aligned ranges.
    recentScoreSnapshotsForDecisionPatterns(90),
    prisma.commitment.findMany({
      where: { createdAt: { gte: daysAgo(90) }, deletedAt: null },
      select: { description: true, status: true, deadline: true, createdAt: true },
    }),
  ]);

  // Always run math analysis (no AI dependency)
  const mathResults = await mathAnalysis(decisions, scores, commitments);

  // Store math patterns as brain memories
  let mathUpsertErrors = 0;
  for (const p of mathResults) {
    await prisma.brainMemory.upsert({
      where: { category_key: { category: BRAIN_CATEGORIES.DECISION_PATTERN, key: `dp_math_${p.name.replace(/\s+/g, "_").toLowerCase().slice(0, 40)}` } },
      create: {
        category: BRAIN_CATEGORIES.DECISION_PATTERN,
        key: `dp_math_${p.name.replace(/\s+/g, "_").toLowerCase().slice(0, 40)}`,
        content: `${p.name}: ${p.finding} → ${p.intervention}`,
        confidence: p.confidence,
        source: "decision_pattern_math",
      },
      update: {
        content: `${p.name}: ${p.finding} → ${p.intervention}`,
        seenCount: { increment: 1 },
        confidence: p.confidence,
      },
    }).catch(() => { mathUpsertErrors++; });
  }
  if (mathUpsertErrors > 0) {
    logError("brain.decision-patterns", new Error(`${mathUpsertErrors} pattern upserts failed`), { fn: "analyzeDecisionPatterns.math" });
  }

  // Optional AI analysis for deeper patterns (may fail, that's OK)
  let aiPatterns: DecisionPattern[] = [];
  if (decisions.length >= 5) {
    try {
      const decisionContext = decisions.slice(0, 20).map(d => {
        const dayScore = scores.find(s => s.date === d.date);
        const hour = d.createdAt ? new Date(d.createdAt).getHours() : null;
        return `${d.date} ${hour ? `@${hour}:00` : ""}: "${d.title}" (${d.stakes}) → grade: ${d.grade || "?"} | energy ${dayScore?.energyLevel ?? "?"}, discipline ${dayScore?.disciplineScore ?? "?"}`;
      });

      const result = await aiChat([
        {
          role: "system",
          content: `Find 2-3 decision patterns. Return JSON array: [{"pattern":"name","evidence":"specific","frequency":3,"actionable":"what to do"}]. Max 3.`,
        },
        { role: "user", content: decisionContext.join("\n") },
      ], "fast");

       
      const extracted = extractJsonArray<any>(result.content);
      if (extracted.ok) {
        const parsed = extracted.value;
        if (Array.isArray(parsed)) aiPatterns = parsed.slice(0, 3);
      }
    } catch (err) {
      logError("brain.decision-patterns", err, { fn: "analyzeDecisionPatterns.ai" });
    }
  }

  return { patterns: aiPatterns, mathPatterns: mathResults };
}

/**
 * Get decision pattern insights for system prompt.
 */
export async function getDecisionPatternContext(): Promise<string> {
  // v10.0.65 · soft-delete bypass fix · system-prompt feeder.
  const patterns = await prisma.brainMemory.findMany({
    where: { category: BRAIN_CATEGORIES.DECISION_PATTERN, confidence: { gte: 0.3 }, deletedAt: null },
    orderBy: { confidence: "desc" },
    take: 5,
    select: { content: true, confidence: true },
  }).catch((err) => {
    logError("brain.decision-patterns", err, { fn: "getDecisionPatternContext.findMany" });
    return [];
  });

  if (patterns.length === 0) return "";

  return [
    `── DECISION PATTERNS (${patterns.length} detected) ──`,
    `Use these to flag when Nour is about to repeat a pattern.`,
    ...patterns.map(p => `• (${(p.confidence * 100).toFixed(0)}%) ${p.content.slice(0, 200)}`),
  ].join("\n");
}
