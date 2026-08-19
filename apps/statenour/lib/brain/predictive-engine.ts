/**
 * Layer 5: Predictive Engine — Forecasts future behavior from historical patterns.
 *
 * Analyzes trends in daily scores, habits, business metrics, drift alerts,
 * and brain dumps to predict what will happen next.
 *
 * Examples:
 * - "Based on your 3-day energy decline, you'll likely skip workouts this weekend."
 * - "Quote follow-ups dropped — conversion will fall 15% by next week if not addressed."
 * - "You haven't logged a daily score in 2 days — historically this leads to a 5-day gap."
 * - "Revenue trend suggests you'll miss the $10K target by $2K this month."
 */

import { prisma } from "@/lib/prisma";
import { proposePredictionOutcome } from "@/lib/brain/calibration-engine";
// v10.0.64 · AgentTrace coverage.
import { makeTracedAiChat } from "@/lib/ai/traced-aichat";
const aiChat = makeTracedAiChat("predictive-engine");
import { extractJsonArray, extractJsonObject } from "@/lib/ai/extract-structured";
import { today, daysAgo, toDateString } from "@/lib/utils/datetime";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { priorityBandLabel } from "@/lib/scoring/task-priority";
import { logError } from "@/lib/utils/error-log";
import {
  recentScoreSnapshots,
  recentDailyHabits,
  recentShopJobs,
  recentShopLeads,
  recentShopQuotes,
} from "@/lib/brain/legacy-shims";

// ─── Data Gathering ──────────────────────────────────────────

async function gatherPredictiveData() {
  const thirtyDaysAgo = daysAgo(30);
  const sevenDaysAgo = daysAgo(7);

  const [
    scores, habits, driftAlerts, openLoops, commitments,
    jobs, leads, quotes, predictions, reflections,
  ] = await Promise.all([
    // v10.0.55 · scores + habits via legacy-shims (DailyScore +
    // HabitLog retired; identity_snapshot + DAILY-tasks now provide).
    recentScoreSnapshots(30),
    recentDailyHabits(30),
    prisma.brainMemory
      .findMany({
        where: {
          category: "coach_event",
          key: { startsWith: "coach:drift-recovery:" },
          createdAt: { gte: thirtyDaysAgo },
          deletedAt: null,
        },
        select: { content: true, metadata: true, createdAt: true },
      })
      .then((rows) =>
        rows.map((r) => {
          const meta = (r.metadata ?? {}) as Record<string, unknown>;
          return {
            ruleName: r.content,
            severity: meta.priority === "P0" ? "critical" : meta.priority === "P1" ? "alert" : "warning",
            resolved: !!meta.ackedAt,
            createdAt: r.createdAt,
          };
        }),
      )
      .catch((): Array<{ ruleName: string; severity: string; resolved: boolean; createdAt: Date }> => []),
    // Apr 18: OpenLoop retired → Task INBOX/READY/DOING.
    prisma.task
      .findMany({
        where: { status: { in: ["INBOX", "READY", "DOING"] } },
        select: { title: true, autoPriority: true, createdAt: true },
      })
      .then((rows) =>
        rows.map((t) => ({
          title: t.title,
          priority: priorityBandLabel(t.autoPriority),
          createdAt: t.createdAt,
        })),
      ),
    prisma.commitment.findMany({
      where: { status: { in: ["active", "in_progress"] }, deletedAt: null },
      select: { description: true, status: true, deadline: true },
    }),
    // v10.0.55 · shop reads via legacy-shims (currently empty; no
    // bridge query exposes ranged jobs/leads/quotes lists).
    recentShopJobs(30),
    recentShopLeads(30),
    recentShopQuotes(30),
    // Previous predictions (to check accuracy and avoid repeats)
    prisma.prediction.findMany({
      where: { createdAt: { gte: sevenDaysAgo } },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { prediction: true, status: true, category: true },
    }),
    prisma.reflection.findMany({
      where: { createdAt: { gte: sevenDaysAgo }, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { insight: true, category: true },
    }),
  ]);

  return { scores, habits, driftAlerts, openLoops, commitments, jobs, leads, quotes, predictions, reflections };
}

function formatPredictiveContext(data: Awaited<ReturnType<typeof gatherPredictiveData>>): string {
  const lines: string[] = [];

  // Score trends
  if (data.scores.length > 0) {
    lines.push("## Daily Score Trend (30d)");
    const weeks = [data.scores.slice(0, 7), data.scores.slice(7, 14), data.scores.slice(14, 21), data.scores.slice(21)];
    weeks.forEach((week, i) => {
      if (week.length === 0) return;
      const avg = week.reduce((s, r) => s + (r.overallScore ?? 0), 0) / week.length;
      const workouts = week.filter((s) => s.workoutDone).length;
      lines.push(`Week ${i + 1}: avg ${avg.toFixed(1)}/10, ${workouts}/${week.length} workouts`);
    });

    // Compute trend direction
    const recentAvg = data.scores.slice(-7).reduce((s, r) => s + (r.overallScore ?? 0), 0) / Math.max(data.scores.slice(-7).length, 1);
    const olderAvg = data.scores.slice(0, 7).reduce((s, r) => s + (r.overallScore ?? 0), 0) / Math.max(data.scores.slice(0, 7).length, 1);
    lines.push(`Trend: ${recentAvg > olderAvg ? "IMPROVING" : recentAvg < olderAvg ? "DECLINING" : "FLAT"} (${olderAvg.toFixed(1)} → ${recentAvg.toFixed(1)})`);
  }

  // Habit completion rates
  if (data.habits.length > 0) {
    lines.push("## Habit Trends");
    const byWeek: Record<string, { done: number; total: number }[]> = {};
    for (const h of data.habits) {
      if (!byWeek[h.habitKey]) byWeek[h.habitKey] = [];
      // Simple: just aggregate
    }
    const habitMap: Record<string, { done: number; total: number }> = {};
    for (const h of data.habits) {
      if (!habitMap[h.habitKey]) habitMap[h.habitKey] = { done: 0, total: 0 };
      habitMap[h.habitKey].total++;
      if (h.completed) habitMap[h.habitKey].done++;
    }
    for (const [k, v] of Object.entries(habitMap)) {
      lines.push(`${k}: ${v.done}/${v.total} (${Math.round((v.done / v.total) * 100)}%)`);
    }
  }

  // Business metrics
  if (data.jobs.length > 0 || data.leads.length > 0) {
    lines.push("## Business Metrics (30d)");
    const totalRevenue = data.jobs.reduce((s, j) => s + Number(j.totalRevenue ?? 0), 0);
    const convertedLeads = data.leads.filter((l) => l.status === "BOOKED").length;
    const bookedQuotes = data.quotes.filter((q) => q.status === "booked").length;
    const totalQuotes = data.quotes.length;
    lines.push(`Jobs: ${data.jobs.length} | Revenue: $${totalRevenue.toFixed(0)}`);
    lines.push(`Leads: ${data.leads.length} (${convertedLeads} converted)`);
    lines.push(`Quotes: ${totalQuotes} (${bookedQuotes} booked, ${totalQuotes > 0 ? Math.round((bookedQuotes / totalQuotes) * 100) : 0}% conversion)`);
  }

  // Drift signals
  lines.push(`## Drift Alerts: ${data.driftAlerts.length} total (${data.driftAlerts.filter((a) => !a.resolved).length} unresolved)`);

  // Open loops age
  if (data.openLoops.length > 0) {
    const avgAge = data.openLoops.reduce((s, l) => s + (Date.now() - l.createdAt.getTime()), 0) / data.openLoops.length / (1000 * 60 * 60 * 24);
    lines.push(`## Open Loops: ${data.openLoops.length} (avg age: ${avgAge.toFixed(0)} days)`);
  }

  // Recent reflections (Layer 4 output feeds Layer 5)
  if (data.reflections.length > 0) {
    lines.push("## Recent Reflections (Layer 4)");
    for (const r of data.reflections) {
      lines.push(`[${r.category}] ${r.insight.slice(0, 150)}`);
    }
  }

  // Previous predictions
  if (data.predictions.length > 0) {
    lines.push("## Previous Predictions (avoid repeating)");
    for (const p of data.predictions) {
      lines.push(`[${p.status}] ${p.prediction.slice(0, 120)}`);
    }
  }

  return lines.join("\n");
}

// ─── Public API ────────────────────────────────────────────────

export interface PredictionResult {
  saved: number;
  predictions: { category: string; prediction: string; targetDate: string; confidence: number }[];
}

export async function runPredictions(): Promise<PredictionResult> {
  const data = await gatherPredictiveData();
  const context = formatPredictiveContext(data);
  const dateStr = today();

  const result = await aiChat([
    {
      role: "system",
      content: `You are the Predictive Engine of NOUR OS — Layer 5 of the memory system.
Your job: forecast what will happen in the next 1-14 days based on historical patterns.

Analyze trends, cycles, and correlations in the data to make SPECIFIC predictions.
Each prediction must have:
- A clear timeframe (target date or range)
- A measurable outcome (not vague)
- Evidence from the data (what pattern led to this)
- A confidence level (0.4-0.9)

Categories: behavior, business, health, drift, operational

Return ONLY a JSON array (2-4 predictions):
[{ "category": "...", "prediction": "...", "basis": "...", "targetDate": "YYYY-MM-DD", "confidence": 0.X }]

GOOD predictions:
- "Estimates-sent without callback within 24h trending 8→11→14; unless follow-up cadence tightens, revenue-from-callbacks drops below $X by Fri."
- "Quote conversion rate trend (40%→32%→28%) predicts sub-25% next week unless follow-up cadence increases."
- "Task completion velocity is 3/day trailing-7; at current inflow (4.2/day) the INBOX lane passes 20 items by ${dateStr}."

BAD predictions:
- "Things might get better" (too vague)
- "You should work out" (advice, not prediction)
- "Revenue could go up or down" (useless hedge)
- Do NOT use the term "open loops" — the OpenLoop model was retired. Say "open tasks" or "tasks in the INBOX/READY lanes" instead.
- Do NOT mention "daily score" or "log score" — DailyScore was retired. Use brain-maturity, task velocity, or identity-axis deltas instead.

Today is ${dateStr}.`,
    },
    { role: "user", content: context },
  ], "reason");

  // v10.0.229 · extractJsonArray with repair pass
  const extracted = extractJsonArray<{
    category: string; prediction: string; basis: string; targetDate: string; confidence: number;
  }>(result.content);
  if (!extracted.ok) return { saved: 0, predictions: [] };

  try {
    const predictions = extracted.value;

    if (!Array.isArray(predictions)) return { saved: 0, predictions: [] };

    // v10.0.46 — wrap creates in a single $transaction. Pre-fix a
    // process crash mid-loop left 1-3 predictions persisted with
    // others lost; a partial save means evaluatePredictions later
    // inspects fewer rows than the AI predicted.
    const slice = predictions.slice(0, 4);
    await prisma.$transaction(
      slice.map((p) =>
        prisma.prediction.create({
          data: {
            date: dateStr,
            targetDate: p.targetDate || toDateString(daysAgo(-7)),
            category: p.category || "behavior",
            prediction: p.prediction,
            basis: p.basis || "",
            confidence: Math.min(Math.max(p.confidence || 0.6, 0.3), 0.95),
          },
        }),
      ),
    );
    const saved: typeof predictions = slice;

    return {
      saved: saved.length,
      predictions: saved.map((p) => ({
        category: p.category,
        prediction: p.prediction,
        targetDate: p.targetDate,
        confidence: p.confidence,
      })),
    };
  } catch (err) {
    logError("brain.predictive-engine", err, { fn: "runPredictions" });
    return { saved: 0, predictions: [] };
  }
}

/**
 * Check past predictions against reality — did they come true?
 */
export async function evaluatePredictions(): Promise<{ checked: number; confirmed: number; disproven: number }> {
  const todayStr = today();
  const pending = await prisma.prediction.findMany({
    where: { status: "pending", targetDate: { lte: todayStr } },
    take: 20,
  });

  if (pending.length === 0) return { checked: 0, confirmed: 0, disproven: 0 };

  let confirmedProposed = 0;
  let disprovenProposed = 0;

  for (const pred of pending) {
    try {
      const proposal = await proposePredictionOutcome(pred);

      await prisma.calibrationReviewItem.upsert({
        where: {
          sourceId_sourceType: {
            sourceId: pred.id,
            sourceType: "Prediction",
          },
        },
        create: {
          type: "prediction",
          sourceId: pred.id,
          sourceType: "Prediction",
          status: "pending",
          predictedOutcome: {
            status: "confirmed",
            confidence: pred.confidence,
            prediction: pred.prediction,
          },
          proposedActualOutcome: {
            status: proposal.status,
            outcomeDescription: proposal.outcomeDescription,
          },
          confidence: pred.confidence,
          evidence: proposal.evidence,
          evidenceFreshness: new Date(),
        },
        update: {
          proposedActualOutcome: {
            status: proposal.status,
            outcomeDescription: proposal.outcomeDescription,
          },
          evidence: proposal.evidence,
          evidenceFreshness: new Date(),
        },
      });

      if (proposal.status === "confirmed") {
        confirmedProposed++;
      } else if (proposal.status === "disproven") {
        disprovenProposed++;
      }
    } catch (err) {
      // Don't crash the entire loop, just log
      logError("brain.predictive-engine", err, { fn: "evaluatePredictions.propose", predId: pred.id });
    }
  }

  // Calibration loop — store accuracy by category as brain memory based on all resolved predictions
  const totalConfirmed = await prisma.prediction.count({ where: { status: "confirmed" } });
  const totalDisproven = await prisma.prediction.count({ where: { status: "disproven" } });
  const totalResolved = totalConfirmed + totalDisproven;

  if (totalResolved >= 2) {
    const rate = totalConfirmed / totalResolved;

    // Get per-category accuracy
    const [allConfirmed, allDisproven] = await Promise.all([
      prisma.prediction.groupBy({ by: ["category"], where: { status: "confirmed" }, _count: true }),
      prisma.prediction.groupBy({ by: ["category"], where: { status: "disproven" }, _count: true }),
    ]);

    const categoryMap: Record<string, { confirmed: number; disproven: number }> = {};
    for (const c of allConfirmed) {
      categoryMap[c.category] = { confirmed: c._count, disproven: 0 };
    }
    for (const d of allDisproven) {
      if (!categoryMap[d.category]) categoryMap[d.category] = { confirmed: 0, disproven: 0 };
      categoryMap[d.category].disproven = d._count;
    }

    const categoryAccuracy = Object.entries(categoryMap)
      .map(([cat, { confirmed: c, disproven: d }]) => {
        const t = c + d;
        return t >= 2 ? `${cat}: ${((c / t) * 100).toFixed(0)}% (${c}/${t})` : null;
      })
      .filter(Boolean)
      .join(", ");

    await prisma.brainMemory.upsert({
      where: { category_key: { category: BRAIN_CATEGORIES.PREDICTION_CALIBRATION, key: "accuracy_current" } },
      create: {
        category: BRAIN_CATEGORIES.PREDICTION_CALIBRATION,
        key: "accuracy_current",
        content: `Overall prediction accuracy: ${(rate * 100).toFixed(0)}% (${totalConfirmed}/${totalResolved}). By category: ${categoryAccuracy || "insufficient data"}. ${rate < 0.4 ? "LOW ACCURACY — reduce confidence on future predictions." : rate > 0.7 ? "Well calibrated." : "Moderate accuracy — room to improve."}`,
        confidence: 0.9,
        source: "prediction_calibration",
      },
      update: {
        content: `Overall prediction accuracy: ${(rate * 100).toFixed(0)}% (${totalConfirmed}/${totalResolved}). By category: ${categoryAccuracy || "insufficient data"}. ${rate < 0.4 ? "LOW ACCURACY — reduce confidence on future predictions." : rate > 0.7 ? "Well calibrated." : "Moderate accuracy — room to improve."}`,
        confidence: 0.9,
        seenCount: { increment: 1 },
      },
    }).catch(() => {});
  }

  return { checked: pending.length, confirmed: confirmedProposed, disproven: disprovenProposed };
}

/**
 * Get active predictions for system prompt.
 */
export async function getActivePredictions(limit = 5): Promise<string> {
  try {
    const predictions = await prisma.prediction.findMany({
      where: { status: "pending" },
      orderBy: [{ confidence: "desc" }, { createdAt: "desc" }],
      take: limit,
      select: { targetDate: true, category: true, prediction: true, confidence: true },
    });

    if (predictions.length === 0) return "";

    const lines = predictions.map((p) =>
      `[${p.category}] (${(p.confidence * 100).toFixed(0)}% conf, by ${p.targetDate}) ${p.prediction.slice(0, 200)}`
    );

    return `\n## Layer 5 — Active Predictions (${predictions.length})\n${lines.join("\n")}`;
  } catch (err) {
    logError("brain.predictive-engine", err, { fn: "getActivePredictions" });
    return "";
  }
}
