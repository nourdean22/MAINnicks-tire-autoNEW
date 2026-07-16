/**
 * Automatic Learning Journal
 *
 * Daily self-assessment of Nick's intelligence: what was learned,
 * predicted, got right, got wrong, and discovered. Stored as a
 * brain memory and surfaced in the evening debrief.
 *
 * Enhanced with:
 * - Learning RATE calculation (memories/day velocity over time)
 * - Weak-spot detection (domains with low learning activity)
 * - Domain velocity (which domains are learning fastest)
 * - Prediction calibration (overconfident vs underconfident)
 * - Knowledge depth scoring (breadth vs depth per category)
 * - 7-day and 30-day learning trends
 * - Stagnation alerts (when learning slows down)
 *
 * This is Nick's METACOGNITION — thinking about his own thinking.
 *
 * v10.0.529.23 · perf cleanup · weak-spot detection was firing 14
 * sequential Prisma round-trips per nightly cron run (findFirst +
 * count per importantDomain × 7 domains). Now folded into a single
 * groupBy with _count + _max(createdAt) folded into the main
 * Promise.all, then aggregated in memory · 1 parallel query instead
 * of 14 sequential. Plus removed the 3 `as any[]` casts on groupBy
 * results by typing the .catch fallbacks against local interfaces.
 * Same semantics · same output shape · 14× fewer DB hits.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
// v10.0.64 · AgentTrace coverage.
import { makeTracedAiChat } from "@/lib/ai/traced-aichat";
const aiChat = makeTracedAiChat("learning-journal");
import { brainMemory } from "@/lib/brain/memory-manager";
import { today, daysAgo, toDateString } from "@/lib/utils/datetime";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logError } from "@/lib/utils/error-log";

// v10.0.529.23 · typed groupBy result shapes · replaces the prior
// `as any[]` casts at the consumer sites. BrainMemory.category is
// non-null per schema (line 1568 of prisma/schema.prisma) so the
// `category` field is typed as `string`.
type CategoryCount = { category: string; _count: number };
type CategoryDepthRow = {
  category: string;
  _count: number;
  _avg: { confidence: number | null };
};
type CategoryLastSeen = {
  category: string;
  _count: number;
  _max: { createdAt: Date | null };
};
type PredictionSlice = { status: string; confidence: number | null };

// v10.0.529.23 · hoisted from inside the function · used by both the
// weak-spot groupBy `where` clause (Promise.all) and the in-memory
// aggregation pass below. Keeping it as a const at module scope so
// the two stay in sync.
const IMPORTANT_DOMAINS = [
  "revenue",
  "body",
  "relationship",
  "strategy",
  "financial",
  "leads",
  "marketing",
] as const;

export interface JournalEntry {
  date: string;
  memoriesCreated: number;
  memoriesDecayed: number;
  predictionsScored: { confirmed: number; disproven: number };
  wisdomDistilled: number;
  blindSpotsFound: number;
  counterIntuitiveFindings: number;
  selfAssessment: string;
  // Enhanced fields
  learningRate: { daily: number; weekly: number; monthly: number; trend: "accelerating" | "steady" | "decelerating" };
  domainVelocity: { domain: string; memoriesThisWeek: number; memoriesLastWeek: number; velocity: number }[];
  weakSpots: { domain: string; daysSinceLastLearning: number; memoryCount: number }[];
  predictionCalibration: { overconfident: number; underconfident: number; wellCalibrated: number; calibrationScore: number };
  knowledgeDepth: { category: string; count: number; avgConfidence: number; depth: "deep" | "moderate" | "shallow" }[];
  stagnationAlert: string | null;
}

/**
 * Generate today's learning journal entry.
 * Runs as part of the evening cron.
 */
export async function generateLearningJournal(): Promise<JournalEntry> {
  const todayStr = today();
  const todayStart = new Date(new Date().setHours(0, 0, 0, 0));
  const sevenDaysAgo = daysAgo(7);
  const fourteenDaysAgo = daysAgo(14);
  const thirtyDaysAgo = daysAgo(30);

  // Gather today's brain activity + historical data for trends.
  // v10.0.529.23 · added `weakSpotStats` slot (1 groupBy query) ·
  // replaces the 14 sequential findFirst+count round-trips that used
  // to run after Promise.all in the old weak-spot detection loop.
  const [
    memoriesCreated,
    memoriesDecayed,
    predictionsConfirmed,
    predictionsDisproven,
    newWisdom,
    blindSpotMemories,
    counterIntuitiveMemories,
    todayReflections,
    // Historical data for learning rate
    memoriesThisWeek,
    memoriesLastWeek,
    memoriesThisMonth,
    // Category breakdown for domain velocity
    categoryCounts,
    categoryCountsLastWeek,
    // All predictions for calibration
    allPredictions,
    // Knowledge depth by category
    categoryDepth,
    // v10.0.529.23 · per-category last-seen + count for the
    // important-domain weak-spot detection · aggregated in memory.
    weakSpotStats,
  ] = await Promise.all([
    prisma.brainMemory.count({ where: { createdAt: { gte: todayStart } } }),
    prisma.brainMemory.count({ where: { updatedAt: { gte: todayStart }, confidence: { lt: 0.2 } } }),
    prisma.prediction.count({ where: { status: "confirmed", updatedAt: { gte: todayStart } } }),
    prisma.prediction.count({ where: { status: "disproven", updatedAt: { gte: todayStart } } }),
    prisma.brainMemory.count({ where: { category: BRAIN_CATEGORIES.WISDOM, createdAt: { gte: todayStart } } }),
    prisma.brainMemory.count({ where: { category: BRAIN_CATEGORIES.BLIND_SPOT, createdAt: { gte: todayStart } } }),
    prisma.brainMemory.count({ where: { category: BRAIN_CATEGORIES.COUNTER_INTUITIVE, createdAt: { gte: todayStart } } }),
    prisma.reflection.findMany({ where: { date: todayStr, deletedAt: null }, select: { insight: true }, take: 3 }),
    // Historical
    prisma.brainMemory.count({ where: { deletedAt: null, createdAt: { gte: sevenDaysAgo } } }),
    prisma.brainMemory.count({ where: { deletedAt: null, createdAt: { gte: fourteenDaysAgo, lt: sevenDaysAgo } } }),
    prisma.brainMemory.count({ where: { deletedAt: null, createdAt: { gte: thirtyDaysAgo } } }),
    // Category breakdown this week · typed catch fallback so the
    // consumer below doesn't need `as any[]`.
    prisma.brainMemory.groupBy({
      by: ["category"],
      where: { deletedAt: null, createdAt: { gte: sevenDaysAgo } },
      _count: true,
    }).catch((): CategoryCount[] => []),
    prisma.brainMemory.groupBy({
      by: ["category"],
      where: { deletedAt: null, createdAt: { gte: fourteenDaysAgo, lt: sevenDaysAgo } },
      _count: true,
    }).catch((): CategoryCount[] => []),
    // Predictions with confidence for calibration
    prisma.prediction.findMany({
      where: { status: { in: ["confirmed", "disproven"] }, updatedAt: { gte: thirtyDaysAgo } },
      select: { status: true, confidence: true },
    }).catch((): PredictionSlice[] => []),
    // Knowledge depth
    prisma.brainMemory.groupBy({
      by: ["category"],
      where: { deletedAt: null },
      _count: true,
      _avg: { confidence: true },
      orderBy: { _count: { category: "desc" } },
    }).catch((): CategoryDepthRow[] => []),
    // v10.0.529.23 · weak-spot detection · was 14 sequential queries
    // (findFirst + count per important domain). Now 1 groupBy that
    // aggregates per matching category · we sum + max in memory
    // below. Same semantics, ~14× fewer DB round-trips.
    prisma.brainMemory.groupBy({
      by: ["category"],
      where: {
        deletedAt: null,
        OR: IMPORTANT_DOMAINS.map((d) => ({ category: { contains: d } })),
      },
      _count: true,
      _max: { createdAt: true },
    }).catch((): CategoryLastSeen[] => []),
  ]);

  // ── Learning Rate ──
  const dailyRate = memoriesCreated;
  const weeklyRate = Math.round(memoriesThisWeek / 7);
  const monthlyRate = Math.round(memoriesThisMonth / 30);

  // Trend: compare this week vs last week
  let learningTrend: "accelerating" | "steady" | "decelerating";
  if (memoriesThisWeek > memoriesLastWeek * 1.2) learningTrend = "accelerating";
  else if (memoriesThisWeek < memoriesLastWeek * 0.8) learningTrend = "decelerating";
  else learningTrend = "steady";

  const learningRate = { daily: dailyRate, weekly: weeklyRate, monthly: monthlyRate, trend: learningTrend };

  // ── Domain Velocity ──
  // v10.0.529.23 · was `(categoryCounts as any[]).map(...)` · now
  // typed via CategoryCount so Map<string, number> infers cleanly.
  const thisWeekMap = new Map<string, number>(
    categoryCounts.map((c) => [c.category, c._count])
  );
  const lastWeekMap = new Map<string, number>(
    categoryCountsLastWeek.map((c) => [c.category, c._count])
  );

  const allDomains = new Set<string>([...thisWeekMap.keys(), ...lastWeekMap.keys()]);
  const domainVelocity = [...allDomains].map(domain => {
    const thisWeek = thisWeekMap.get(domain) ?? 0;
    const lastWeek = lastWeekMap.get(domain) ?? 0;
    const velocity = lastWeek > 0 ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : (thisWeek > 0 ? 100 : 0);
    return { domain, memoriesThisWeek: thisWeek, memoriesLastWeek: lastWeek, velocity };
  }).sort((a, b) => b.velocity - a.velocity).slice(0, 10);

  // ── Weak Spots ──
  // v10.0.529.23 · domains with goals/missions but low recent
  // learning. Was 14 sequential queries (findFirst + count per
  // domain × 7 domains). Now in-memory aggregation over the
  // weakSpotStats slot from the Promise.all above · sum counts +
  // max(createdAt) across all matching categories for each domain.
  // Same semantics as the pre-fix `contains` match — a domain like
  // "revenue" still aggregates "revenue_strategy" + "revenue_leads"
  // + bare "revenue" into one weak-spot row.
  const weakSpots: JournalEntry["weakSpots"] = [];
  for (const domain of IMPORTANT_DOMAINS) {
    const thisWeekCount = thisWeekMap.get(domain) ?? 0;
    if (thisWeekCount >= 2) continue;

    let totalInDomain = 0;
    let lastSeenAt: Date | null = null;
    for (const stat of weakSpotStats) {
      if (stat.category.includes(domain)) {
        totalInDomain += stat._count;
        const at = stat._max.createdAt;
        if (at && (!lastSeenAt || at > lastSeenAt)) lastSeenAt = at;
      }
    }

    const daysSinceLast = lastSeenAt
      ? Math.round((Date.now() - lastSeenAt.getTime()) / 86400000)
      : 999;

    if (daysSinceLast >= 7 || totalInDomain < 5) {
      weakSpots.push({ domain, daysSinceLastLearning: daysSinceLast, memoryCount: totalInDomain });
    }
  }

  // ── Prediction Calibration ──
  let overconfident = 0, underconfident = 0, wellCalibrated = 0;

  for (const p of allPredictions) {
    const conf = p.confidence ?? 0.5;
    if (p.status === "confirmed" && conf < 0.4) underconfident++;
    else if (p.status === "disproven" && conf > 0.7) overconfident++;
    else wellCalibrated++;
  }

  const totalScored = overconfident + underconfident + wellCalibrated;
  const calibrationScore = totalScored > 0 ? Math.round((wellCalibrated / totalScored) * 100) : 50;

  const predictionCalibration = { overconfident, underconfident, wellCalibrated, calibrationScore };

  // ── Knowledge Depth ──
  // v10.0.529.23 · was `(categoryDepth as any[]).slice(...)` · now
  // typed via CategoryDepthRow so the chained calls infer cleanly.
  const knowledgeDepth = categoryDepth.slice(0, 15).map((c) => {
    const count = c._count;
    const avgConf = c._avg?.confidence ?? 0.5;
    const depth =
      count >= 20 && avgConf >= 0.6
        ? ("deep" as const)
        : count >= 5
          ? ("moderate" as const)
          : ("shallow" as const);
    return { category: c.category, count, avgConfidence: Math.round(avgConf * 100) / 100, depth };
  });

  // ── Stagnation Alert ──
  let stagnationAlert: string | null = null;
  if (learningTrend === "decelerating" && memoriesThisWeek < memoriesLastWeek * 0.5) {
    stagnationAlert = `Learning rate dropped ${Math.round((1 - memoriesThisWeek / memoriesLastWeek) * 100)}% this week. Are you engaging with Nick less? Fewer brain dumps? The system learns from your input.`;
  } else if (memoriesCreated === 0 && new Date().getHours() >= 18) {
    stagnationAlert = "Zero new memories today. The brain didn't learn anything. Log a score, talk to Nick, or do a brain dump.";
  } else if (weakSpots.length >= 3) {
    stagnationAlert = `${weakSpots.length} domains have gone quiet: ${weakSpots.map(w => w.domain).join(", ")}. Blind spots forming.`;
  }

  // ── AI self-assessment ──
  let selfAssessment = "";
  try {
    const result = await aiChat(
      [
        {
          role: "system",
          content: `You are the NOUR OS brain writing a brief self-assessment (3 sentences max).
Assess today's learning: what was new, what was confirmed, what was wrong, what needs more data.
Be honest about mistakes. Be specific about what changed in understanding.
Don't be generic — reference specific numbers.`,
        },
        {
          role: "user",
          content: `Today's brain metrics:
- ${memoriesCreated} new memories created (${learningTrend} trend, ${weeklyRate}/day avg this week)
- ${memoriesDecayed} memories decayed
- Predictions: ${predictionsConfirmed} confirmed, ${predictionsDisproven} wrong (calibration: ${calibrationScore}/100)
- ${newWisdom} wisdom, ${blindSpotMemories} blind spots, ${counterIntuitiveMemories} counter-intuitive
- Weak spots: ${weakSpots.map(w => w.domain).join(", ") || "none"}
- ${stagnationAlert ? `STAGNATION: ${stagnationAlert}` : "No stagnation detected"}
- Reflections: ${todayReflections.map(r => r.insight.slice(0, 60)).join("; ") || "none"}`,
        },
      ],
      "fast"
    );
    selfAssessment = result.content.trim();
  } catch (err) {
    logError("brain.learning-journal", err, { fn: "generateLearningJournal.aiChat" });
    selfAssessment = `Created ${memoriesCreated} memories (${learningTrend}). ${predictionsConfirmed + predictionsDisproven > 0 ? `Scored ${predictionsConfirmed + predictionsDisproven} predictions (${calibrationScore}% calibrated).` : ""} ${weakSpots.length > 0 ? `Weak: ${weakSpots.map(w => w.domain).join(", ")}.` : ""}`;
  }

  const entry: JournalEntry = {
    date: todayStr,
    memoriesCreated,
    memoriesDecayed,
    predictionsScored: { confirmed: predictionsConfirmed, disproven: predictionsDisproven },
    wisdomDistilled: newWisdom,
    blindSpotsFound: blindSpotMemories,
    counterIntuitiveFindings: counterIntuitiveMemories,
    selfAssessment,
    learningRate,
    domainVelocity,
    weakSpots,
    predictionCalibration,
    knowledgeDepth,
    stagnationAlert,
  };

  // Store as brain memory · brainMemory.remember() handles the
  // content row + embedding + (irrelevant here) wisdom-gate.
  const stored = await brainMemory.remember(
    "learning_journal",
    `journal_${todayStr}`,
    `[${todayStr}] ${selfAssessment} | Rate: ${weeklyRate}/day (${learningTrend}). Calibration: ${calibrationScore}/100. Weak: ${weakSpots.map(w => w.domain).join(",") || "none"}. ${stagnationAlert ? `ALERT: ${stagnationAlert}` : ""}`,
    "learning-journal"
  );

  // v10.0.529.24 · persist the structured JournalEntry as metadata
  // on the BrainMemory row · enables `getLatestLearningJournalEntry`
  // below to read today's metacognition without re-running the cron.
  // `remember()` doesn't accept metadata for the reinforce-path (when
  // the same key is re-written same-day) · the separate update keeps
  // metadata fresh on both create + reinforce paths. Best-effort ·
  // failures don't surface to the cron exit code.
  try {
    await prisma.brainMemory.update({
      where: { id: stored.id },
      data: { metadata: entry as unknown as Prisma.InputJsonValue },
    });
  } catch (err) {
    // metadata persistence is non-critical · the cron's primary job is
    // to compute + log the entry · UI surfacing is downstream.
    logError("brain.learning-journal", err, { fn: "generateLearningJournal.updateMetadata" });
  }

  return entry;
}

/**
 * v10.0.529.24 · Read the most-recent learning-journal entry for the
 * /journal page metacognition card. Returns null if no entry exists
 * (fresh install, cron hasn't run yet, or metadata-less legacy rows).
 *
 * Cheap · 1 indexed read · safe to call on every page load.
 */
export async function getLatestLearningJournalEntry(): Promise<JournalEntry | null> {
  try {
    const row = await prisma.brainMemory.findFirst({
      where: { category: BRAIN_CATEGORIES.LEARNING_JOURNAL, deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: { metadata: true },
    });
    if (!row?.metadata) return null;
    // metadata is `Json?` in Prisma · cast back to JournalEntry · the
    // writer above persists the typed entry directly so the shape is
    // controlled. Legacy rows without metadata return null at the
    // `!row?.metadata` guard above.
    return row.metadata as unknown as JournalEntry;
  } catch (err) {
    logError("brain.learning-journal", err, { fn: "getLatestLearningJournalEntry" });
    return null;
  }
}

/**
 * Get recent journal context for the system prompt.
 */
export async function getLearningJournalContext(): Promise<string> {
  try {
    // v10.0.65 · soft-delete bypass fix · system-prompt feeder.
    const entries = await prisma.brainMemory.findMany({
      where: { category: BRAIN_CATEGORIES.LEARNING_JOURNAL, deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 3,
      select: { content: true },
    });

    if (entries.length === 0) return "";

    return [
      `── LEARNING JOURNAL (metacognition) ──`,
      ...entries.map(e => e.content.slice(0, 250)),
      `Nick's brain is ${entries[0]?.content.includes("accelerating") ? "learning faster" : entries[0]?.content.includes("decelerating") ? "slowing down — needs engagement" : "learning at a steady pace"}.`,
    ].join("\n");
  } catch (err) {
    logError("brain.learning-journal", err, { fn: "getLearningJournalContext" });
    return "";
  }
}
