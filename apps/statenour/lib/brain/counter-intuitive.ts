/**
 * Counter-Intuitive Alert Engine
 *
 * Surfaces data that CONTRADICTS Nour's current assumptions.
 * Most intelligence systems confirm what you already believe (confirmation bias).
 * This engine deliberately looks for disconfirming evidence.
 *
 * Examples:
 * - "You think Mondays are your best day, but data shows Wednesdays outperform by 18%"
 * - "You assume bigger quotes convert less, but quotes $800-1200 actually convert at 45% vs 38% for under $500"
 * - "You think rain hurts business, but rainy days had 12% higher revenue this quarter"
 * - "You spent 4 hours on system work yesterday. The 3 leads that went cold cost more than the system saved."
 */

import { prisma } from "@/lib/prisma";
import { brainMemory } from "@/lib/brain/memory-manager";
import { daysAgo, weekdayET } from "@/lib/utils/datetime";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import {
  recentScoreSnapshots,
  recentShopJobs,
  recentShopLeads,
  recentShopQuotes,
} from "@/lib/brain/legacy-shims";

export interface CounterIntuitive {
  assumption: string;
  reality: string;
  dataPoints: number;
  impact: string;
  category: string;
  /**
   * Argyris's espoused-vs-in-use lens applied to the assumption.
   * Espoused = what Nour says (assumption text).
   * InUse = what behavior actually shows (reality text).
   */
  espousedVsInUse?: { gap: number; severity: "small" | "moderate" | "wide" };
  /**
   * Aristotle's akrasia framing — "knowing the good and not doing it"
   * — preferred over identity-attack framing ("you're inconsistent").
   */
  akrasiaFraming?: string;
}

/**
 * FESTINGER COGNITIVE DISSONANCE (Leon Festinger, 1957) +
 * SARTRE BAD FAITH (Being and Nothingness, 1943)
 *
 * When humans hold a value but act against it, they rationalize.
 * The most expensive form is denying free choice — "I had to,"
 * "There was no choice." Sartre called this bad faith.
 *
 * Detect rationalization-language frequency. When > baseline, the
 * counter-intuitive finding is real and the rationalization itself
 * is the symptom.
 */
export const RATIONALIZATION_PATTERNS: readonly string[] = [
  "i had to",
  "there was no choice",
  "had no other option",
  "couldn't have",
  "it made sense at the time",
  "special circumstance",
  "this time was different",
  "i'll start tomorrow",
  "just this once",
  "i deserve",
  "i was tired",
  "the situation forced",
  "i'm just",
  "that's how it has to be",
];

export function countRationalizations(text: string): {
  count: number;
  matches: string[];
} {
  const lower = text.toLowerCase();
  const matches: string[] = [];
  for (const phrase of RATIONALIZATION_PATTERNS) {
    if (lower.includes(phrase)) matches.push(phrase);
  }
  return { count: matches.length, matches };
}

/**
 * SAMUELSON REVEALED PREFERENCE (Paul Samuelson, 1938 — Nobel 1970)
 *
 * What people DO reveals what they actually value. Stated preferences
 * are noise; behavior is signal.
 *
 * Given a list of stated values + a list of actions (with weight per
 * action), compute the espoused-vs-revealed leaderboard.
 *
 * Returns: stated rank vs revealed rank for each value, plus the
 * delta (positive = revealed-rank higher than stated).
 */
export function revealedPreferenceRanking(
  statedRanks: Array<{ value: string; rank: number }>,
  actions: Array<{ value: string; weight: number }>,
): Array<{
  value: string;
  statedRank: number;
  revealedRank: number;
  delta: number;
}> {
  const totals = new Map<string, number>();
  for (const a of actions) {
    totals.set(a.value, (totals.get(a.value) ?? 0) + a.weight);
  }
  const revealed = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([value], idx) => ({ value, rank: idx + 1 }));

  const findRevealedRank = (value: string): number => {
    const found = revealed.find((r) => r.value === value);
    return found?.rank ?? statedRanks.length + 1;
  };

  return statedRanks.map((s) => ({
    value: s.value,
    statedRank: s.rank,
    revealedRank: findRevealedRank(s.value),
    delta: findRevealedRank(s.value) - s.rank,
  }));
}

/**
 * ARGYRIS ESPOUSED-VS-IN-USE GAP (Chris Argyris, 1974)
 *
 * Score the magnitude of the gap between what's said and what's done.
 * Used to severity-stamp counter-intuitive findings — wide gaps
 * surface first.
 */
export function gapSeverity(
  statedConfidence: number,
  observedConfidence: number,
): { gap: number; severity: "small" | "moderate" | "wide" } {
  // Floating-point note: gaps that should be exactly 0.2 (e.g.
  // |0.7 - 0.5|) sometimes compute as 0.1999... Use a small epsilon
  // so 0.2 lands in "moderate", not "small".
  const gap = Math.abs(statedConfidence - observedConfidence);
  const eps = 1e-9;
  return {
    gap,
    severity:
      gap < 0.2 - eps ? "small" : gap < 0.5 - eps ? "moderate" : "wide",
  };
}

/**
 * ARISTOTLE AKRASIA FRAMING + DWECK GROWTH MINDSET
 *
 * Akrasia (Aristotle, Nicomachean Ethics): "knowing the good and
 *  doing otherwise" — universal human condition, not character flaw.
 * Dweck (2006): framing failure as data outperforms framing as identity.
 *
 * Wraps a counter-intuitive finding in non-attacking language. Frame
 * matters. Identity-attack ("you're inconsistent") shuts the listener
 * down; akrasia framing ("you knew the better move and didn't take
 * it — common, recoverable") keeps the conversation open.
 */
export function frameAsAkrasia(reality: string, assumption: string): string {
  return `You knew the better move ("${assumption.slice(0, 60).trim()}") and didn't take it. Aristotle called this akrasia — universal weakness of will, not a character flaw. The data shows: ${reality.slice(0, 100).trim()}. Recoverable. Question is whether the gap is signal about a bad rule, or a missing system.`;
}

/**
 * Analyze data for patterns that contradict common assumptions.
 */
export async function findCounterIntuitive(): Promise<CounterIntuitive[]> {
  const findings: CounterIntuitive[] = [];
  const ninetyDaysAgo = daysAgo(90);

  // Gather data — typed fallback arrays so downstream code compiles
  type JobRow = { jobDate: Date; totalRevenue: number | null; serviceCategory: string | null };
  type ScoreRow = { date: string; overallScore: number | null; energyLevel: number | null; workoutDone: boolean; focusQuality: number | null };
  type QuoteRow = { grandTotal: number | null; status: string; createdAt: Date };
  type LeadRow = { status: string; urgency: string | null; timeToResponseMinutes: number | null; source: string | null; createdAt: Date };

  const [jobs, scores, quotes, leads] = await Promise.all([
    // v10.0.55 · sourced via legacy-shims; shop reads currently empty.
    recentShopJobs(30) as unknown as Promise<JobRow[]>,
    recentScoreSnapshots(30) as unknown as Promise<ScoreRow[]>,
    recentShopQuotes(30) as unknown as Promise<QuoteRow[]>,
    recentShopLeads(30) as unknown as Promise<LeadRow[]>,
  ]);

  // ── Day-of-week revenue analysis ──
  if (jobs.length >= 20) {
    const byDow: Record<number, { total: number; count: number }> = {};
    for (const j of jobs) {
      const dow = weekdayET(j.jobDate);
      if (!byDow[dow]) byDow[dow] = { total: 0, count: 0 };
      byDow[dow].total += Number(j.totalRevenue);
      byDow[dow].count++;
    }

    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const avgByDay = Object.entries(byDow)
      .map(([dow, d]) => ({ day: dayNames[Number(dow)], avg: d.count > 0 ? d.total / d.count : 0 }))
      .sort((a, b) => b.avg - a.avg);

    if (avgByDay.length >= 2) {
      const best = avgByDay[0];
      const worst = avgByDay[avgByDay.length - 1];
      if (best.day !== "Mon") { // Most people assume Monday is best
        findings.push({
          assumption: "Monday is the busiest revenue day",
          reality: `${best.day} actually averages $${best.avg.toFixed(0)}/day vs Monday's $${byDow[1]?.count > 0 ? (byDow[1].total / byDow[1].count).toFixed(0) : "0"}`,
          dataPoints: jobs.length,
          impact: `Staffing and marketing could be optimized for ${best.day}`,
          category: BRAIN_CATEGORIES.REVENUE,
        });
      }
    }
  }

  // ── Quote value vs conversion rate ──
  // v10.0.55 · QuoteRow.grandTotal is nullable in the legacy shape;
  // filter to non-null before bucketing.
  const sizedQuotes = quotes.filter((q): q is typeof q & { grandTotal: number } =>
    typeof q.grandTotal === "number" && q.grandTotal !== null,
  );
  if (sizedQuotes.length >= 15) {
    const lowQuotes = sizedQuotes.filter((q) => q.grandTotal < 500);
    const highQuotes = sizedQuotes.filter((q) => q.grandTotal >= 500 && q.grandTotal < 1500);
    const premiumQuotes = sizedQuotes.filter((q) => q.grandTotal >= 1500);

    const lowRate = lowQuotes.length > 0 ? lowQuotes.filter((q) => q.status === "booked").length / lowQuotes.length : 0;
    const highRate = highQuotes.length > 0 ? highQuotes.filter((q) => q.status === "booked").length / highQuotes.length : 0;
    const premiumRate = premiumQuotes.length > 0 ? premiumQuotes.filter((q) => q.status === "booked").length / premiumQuotes.length : 0;

    if (highRate > lowRate && highQuotes.length >= 5 && lowQuotes.length >= 5) {
      findings.push({
        assumption: "Cheaper quotes convert better",
        reality: `$500-1500 quotes convert at ${(highRate * 100).toFixed(0)}% vs under-$500 at ${(lowRate * 100).toFixed(0)}%`,
        dataPoints: lowQuotes.length + highQuotes.length,
        impact: "Mid-range customers may value quality over price. Consider premium positioning.",
        category: BRAIN_CATEGORIES.PRICING,
      });
    }
  }

  // ── Workout → revenue correlation check ──
  if (scores.length >= 14 && jobs.length >= 14) {
    const scoreMap = new Map(scores.map((s) => [s.date, s] as const));

    let workoutDayRevenue = 0;
    let workoutDays = 0;
    let noWorkoutRevenue = 0;
    let noWorkoutDays = 0;

    for (const j of jobs) {
      const dateStr = j.jobDate.toISOString().split("T")[0];
      const score = scoreMap.get(dateStr);
      if (!score) continue;

      if (score.workoutDone) {
        workoutDayRevenue += Number(j.totalRevenue);
        workoutDays++;
      } else {
        noWorkoutRevenue += Number(j.totalRevenue);
        noWorkoutDays++;
      }
    }

    const workoutAvg = workoutDays > 0 ? workoutDayRevenue / workoutDays : 0;
    const noWorkoutAvg = noWorkoutDays > 0 ? noWorkoutRevenue / noWorkoutDays : 0;

    if (workoutDays >= 5 && noWorkoutDays >= 5) {
      const diff = ((workoutAvg - noWorkoutAvg) / noWorkoutAvg * 100).toFixed(0);
      findings.push({
        assumption: "Workouts and revenue are correlated (Body→Business chain)",
        reality: `Workout days avg $${workoutAvg.toFixed(0)} vs non-workout $${noWorkoutAvg.toFixed(0)} (${Number(diff) > 0 ? "+" : ""}${diff}%)`,
        dataPoints: workoutDays + noWorkoutDays,
        impact: Number(diff) > 10
          ? "Confirmed: Body→Business chain is real. Protect workout time."
          : Number(diff) < -5
            ? "COUNTER-INTUITIVE: Non-workout days actually performed better. The causation may be indirect."
            : "The correlation is weak. Other factors may matter more.",
        category: BRAIN_CATEGORIES.CAUSATION,
      });
    }
  }

  // ── Lead source conversion ──
  // v10.0.55 · LegacyShopLead.source is nullable; skip null-source rows.
  if (leads.length >= 10) {
    const bySource: Record<string, { total: number; converted: number }> = {};
    for (const l of leads) {
      if (!l.source) continue;
      if (!bySource[l.source]) bySource[l.source] = { total: 0, converted: 0 };
      bySource[l.source].total++;
      if (l.status === "BOOKED") bySource[l.source].converted++;
    }

    const sourceRates = Object.entries(bySource)
      .filter(([, d]) => d.total >= 3)
      .map(([source, d]) => ({
        source,
        rate: d.converted / d.total,
        total: d.total,
      }))
      .sort((a, b) => b.rate - a.rate);

    if (sourceRates.length >= 2) {
      const best = sourceRates[0];
      const worst = sourceRates[sourceRates.length - 1];

      findings.push({
        assumption: `All lead sources convert equally`,
        reality: `${best.source} converts at ${(best.rate * 100).toFixed(0)}% (n=${best.total}) vs ${worst.source} at ${(worst.rate * 100).toFixed(0)}% (n=${worst.total})`,
        dataPoints: leads.length,
        impact: `Consider shifting marketing spend toward ${best.source} leads`,
        category: BRAIN_CATEGORIES.LEADS,
      });
    }
  }

  // ── High energy → decision quality check ──
  if (scores.length >= 14) {
    // Check if decisions made on high-energy days score better
    type DecisionRow = { date: string; grade: string | null; stakes: string };
    const decisions = await prisma.masteryDecision.findMany({
      where: { createdAt: { gte: ninetyDaysAgo }, deletedAt: null },
      select: { date: true, grade: true, stakes: true },
    }).catch((): DecisionRow[] => []);

    if (decisions.length >= 10) {
      const scoreMap = new Map(scores.map((s) => [s.date, s] as const));
      let highEnergyGrades = 0, highEnergyCount = 0;
      let lowEnergyGrades = 0, lowEnergyCount = 0;

      const gradeMap: Record<string, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 };

      for (const d of decisions) {
        if (!d.grade) continue;
        const score = scoreMap.get(d.date);
        if (!score) continue;
        const gradeVal = gradeMap[d.grade.charAt(0).toUpperCase()] ?? 2;

        if ((score.energyLevel ?? 0) >= 7) {
          highEnergyGrades += gradeVal;
          highEnergyCount++;
        } else if ((score.energyLevel ?? 0) <= 4) {
          lowEnergyGrades += gradeVal;
          lowEnergyCount++;
        }
      }

      if (highEnergyCount >= 3 && lowEnergyCount >= 3) {
        const highAvg = highEnergyGrades / highEnergyCount;
        const lowAvg = lowEnergyGrades / lowEnergyCount;

        if (lowAvg > highAvg + 0.3) {
          findings.push({
            assumption: "High energy = better decisions",
            reality: `Low-energy days actually produce better decision grades (${lowAvg.toFixed(1)} vs ${highAvg.toFixed(1)} on A-F scale)`,
            dataPoints: highEnergyCount + lowEnergyCount,
            impact: "High energy may lead to overconfidence. Low energy forces more careful deliberation.",
            category: BRAIN_CATEGORIES.DECISION_QUALITY,
          });
        }
      }
    }
  }

  // ── Multi-service quotes → conversion (upsell vs scare-away) ──
  // v10.0.55 · use the same non-null filter as the value-vs-rate block.
  const sizedForBundle = quotes.filter(
    (q): q is typeof q & { grandTotal: number } =>
      typeof q.grandTotal === "number" && q.grandTotal !== null,
  );
  if (sizedForBundle.length >= 15) {
    const singleService = sizedForBundle.filter((q) => q.grandTotal < 300);
    const multiService = sizedForBundle.filter((q) => q.grandTotal >= 600);

    if (singleService.length >= 5 && multiService.length >= 5) {
      const singleRate = singleService.filter((q) => q.status === "booked").length / singleService.length;
      const multiRate = multiService.filter((q) => q.status === "booked").length / multiService.length;

      if (multiRate >= singleRate - 0.05) {
        findings.push({
          assumption: "Bigger quotes scare customers away",
          reality: `Multi-service quotes ($600+) convert at ${(multiRate * 100).toFixed(0)}% vs single-service (<$300) at ${(singleRate * 100).toFixed(0)}%`,
          dataPoints: singleService.length + multiService.length,
          impact: multiRate > singleRate
            ? "Customers who need more work are MORE committed. They've already decided to fix the car — they're not price-shopping."
            : "Similar conversion rates mean upselling isn't hurting you. The extra revenue per converted quote is pure margin.",
          category: BRAIN_CATEGORIES.PRICING,
        });
      }
    }
  }

  // ── Weekend leads vs weekday conversion ──
  if (leads.length >= 20) {
    const weekendLeads = leads.filter((l) => {
      const day = weekdayET(new Date(l.createdAt));
      return day === 0 || day === 6;
    });
    const weekdayLeads = leads.filter((l) => {
      const day = weekdayET(new Date(l.createdAt));
      return day >= 1 && day <= 5;
    });

    if (weekendLeads.length >= 5 && weekdayLeads.length >= 10) {
      const weekendRate = weekendLeads.filter((l) => l.status === "BOOKED").length / weekendLeads.length;
      const weekdayRate = weekdayLeads.filter((l) => l.status === "BOOKED").length / weekdayLeads.length;

      if (weekendRate > weekdayRate + 0.05) {
        findings.push({
          assumption: "Weekday leads are more serious",
          reality: `Weekend leads convert at ${(weekendRate * 100).toFixed(0)}% vs weekday ${(weekdayRate * 100).toFixed(0)}%`,
          dataPoints: weekendLeads.length + weekdayLeads.length,
          impact: "Weekend researchers have TIME to think. They're not rushed. By Monday they're ready to commit.",
          category: BRAIN_CATEGORIES.LEADS,
        });
      } else if (weekdayRate > weekendRate + 0.1) {
        findings.push({
          assumption: "All leads are created equal",
          reality: `Weekday leads convert ${((weekdayRate - weekendRate) * 100).toFixed(0)}% better than weekend leads`,
          dataPoints: weekendLeads.length + weekdayLeads.length,
          impact: "Weekend leads may be comparison-shopping. Prioritize fast response on weekday leads.",
          category: BRAIN_CATEGORIES.LEADS,
        });
      }
    }
  }

  // ── Response delay check — is there a sweet spot? ──
  if (leads.length >= 15) {
    const withTime = leads.filter((l) => l.timeToResponseMinutes != null && l.timeToResponseMinutes > 0);
    const instant = withTime.filter((l) => l.timeToResponseMinutes! < 15);
    const moderate = withTime.filter((l) => l.timeToResponseMinutes! >= 15 && l.timeToResponseMinutes! <= 60);
    const delayed = withTime.filter((l) => l.timeToResponseMinutes! > 60);

    if (instant.length >= 3 && moderate.length >= 3) {
      const instantRate = instant.filter((l) => l.status === "BOOKED").length / instant.length;
      const modRate = moderate.filter((l) => l.status === "BOOKED").length / moderate.length;

      if (modRate > instantRate + 0.1) {
        findings.push({
          assumption: "Fastest response wins",
          reality: `15-60 min responses convert at ${(modRate * 100).toFixed(0)}% vs instant (<15 min) at ${(instantRate * 100).toFixed(0)}%`,
          dataPoints: instant.length + moderate.length,
          impact: "Instant responses may feel automated/desperate. A 15-30 min response feels personal and deliberate.",
          category: BRAIN_CATEGORIES.RESPONSE_TIMING,
        });
      }
    }
  }

  // Store findings as brain memories (increased to 5)
  for (const finding of findings.slice(0, 5)) {
    await brainMemory.remember(
      "counter_intuitive",
      `ci_${finding.category}_${Date.now()}`,
      `COUNTER-INTUITIVE [${finding.category}]: Assumption: "${finding.assumption}" → Reality: "${finding.reality}" (${finding.dataPoints} data points). Impact: ${finding.impact}`,
      "counter-intuitive-engine"
    ).catch(() => {});
  }

  return findings;
}

/**
 * Get counter-intuitive context for system prompt.
 */
export async function getCounterIntuitiveContext(): Promise<string> {
  try {
    // Pull from stored memories (computed during cron, not live).
    // v10.0.65 · soft-delete bypass fix · system-prompt feeder.
    const memories = await prisma.brainMemory.findMany({
      where: { category: BRAIN_CATEGORIES.COUNTER_INTUITIVE, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { content: true },
    });

    if (memories.length === 0) return "";

    return [
      `── COUNTER-INTUITIVE: DATA THAT CHALLENGES ASSUMPTIONS ──`,
      ...memories.map((m) => m.content.slice(0, 200)),
      `Use these to challenge Nour's assumptions when relevant. Show him the data.`,
    ].join("\n");
  } catch {
    return "";
  }
}
