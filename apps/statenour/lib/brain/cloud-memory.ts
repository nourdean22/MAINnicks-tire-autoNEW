/**
 * Persistent Cloud Memory — Cross-Session Brain State Preservation
 *
 * Ensures the brain never loses state between deploys, crashes, or restarts.
 * Creates periodic snapshots of the entire brain state and stores them
 * as structured audit events for recovery.
 *
 * This is what makes Nick's memory feel truly persistent —
 * he remembers everything across all sessions.
 */

import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logError } from "@/lib/utils/error-log";

interface BrainSnapshot {
  timestamp: string;
  version: number;
  state: {
    memoryCount: number;
    topMemories: Array<{ category: string; key: string; content: string; confidence: number }>;
    activeAlerts: number;
    openLoops: number;
    activeCommitments: number;
    recentScores: Array<{ date: string; score: number }>;
    conversationCount: number;
    lastConversationTopics: string[];
    pageVisitPatterns: Record<string, number>;
    brainHealth: {
      avgConfidence: number;
      totalCategories: number;
      oldestMemory: string | null;
      newestMemory: string | null;
    };
  };
}

/**
 * Create a comprehensive brain state snapshot.
 * Called by crons (daily) and before significant events.
 */
export async function createBrainSnapshot(): Promise<BrainSnapshot> {
  const [
    memCount,
    topMems,
    alerts,
    loops,
    commitments,
    scores,
    convos,
    recentConvoSummaries,
    pageVisits,
    avgConf,
    memRange,
    categories,
  ] = await Promise.all([
    // v9.1.18 · added deletedAt:null on every soft-delete model.
    // The cloud-memory dashboard was inflating counts with ghost
    // rows from soft-deleted memories/tasks/commitments.
    prisma.brainMemory.count({ where: { deletedAt: null } }),
    prisma.brainMemory.findMany({
      where: { deletedAt: null },
      orderBy: { confidence: "desc" },
      take: 50,
      select: { category: true, key: true, content: true, confidence: true },
    }),
    (async () => {
      const { getUnresolvedAlerts } = await import("@/lib/mastery/drift-engine");
      return (await getUnresolvedAlerts().catch(() => [])).length;
    })(),
    prisma.task.count({ where: { deletedAt: null, status: { in: ["INBOX", "READY", "DOING"] } } }),
    prisma.commitment.count({ where: { deletedAt: null, status: { in: ["active", "in_progress"] } } }),
    // v10.0.55 · scores slot — typed to match the legacy DailyScore
    // shape that the consumer reads (`s.date`, `s.overallScore`)
    // even though we currently degrade to empty. Future bridge
    // wiring would replace this with a real source.
    Promise.resolve([] as Array<{ date: string; overallScore: number | null }>),
    prisma.chatConversation.count(),
    prisma.auditEvent.findMany({
      where: { eventType: "conversation_summary" },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { payload: true },
    }),
    prisma.auditEvent.findMany({
      where: { eventType: "page_visit", createdAt: { gte: new Date(Date.now() - 7 * 86400000) } },
      select: { detail: true },
      take: 500,
    }),
    prisma.brainMemory.aggregate({ where: { deletedAt: null }, _avg: { confidence: true } }),
    prisma.brainMemory.aggregate({ where: { deletedAt: null }, _min: { createdAt: true }, _max: { createdAt: true } }),
    prisma.brainMemory.groupBy({ by: ["category"], where: { deletedAt: null }, _count: { id: true } }),
  ]);

  // Page visit patterns
  const pageCounts: Record<string, number> = {};
  for (const v of pageVisits) {
    pageCounts[v.detail || "?"] = (pageCounts[v.detail || "?"] || 0) + 1;
  }

  // Recent conversation topics
  const topics: string[] = [];
  for (const s of recentConvoSummaries) {
    const payload = s.payload as any;
    if (payload?.topics) topics.push(...payload.topics);
  }

  const snapshot: BrainSnapshot = {
    timestamp: new Date().toISOString(),
    version: 1,
    state: {
      memoryCount: memCount,
      topMemories: topMems.map(m => ({ category: m.category, key: m.key, content: m.content.slice(0, 200), confidence: m.confidence })),
      activeAlerts: alerts,
      openLoops: loops,
      activeCommitments: commitments,
      recentScores: scores.map(s => ({ date: s.date, score: s.overallScore ?? 0 })),
      conversationCount: convos,
      lastConversationTopics: [...new Set(topics)].slice(0, 10),
      pageVisitPatterns: pageCounts,
      brainHealth: {
        avgConfidence: avgConf._avg.confidence ?? 0,
        totalCategories: categories.length,
        oldestMemory: memRange._min.createdAt?.toISOString() ?? null,
        newestMemory: memRange._max.createdAt?.toISOString() ?? null,
      },
    },
  };

  // Store as audit event
  await prisma.auditEvent.create({
    data: {
      actor: "cloud_memory",
      eventType: "brain_snapshot",
      detail: `Snapshot v${snapshot.version}: ${memCount} memories, ${alerts} alerts, ${loops} loops`,
      payload: snapshot as any,
    },
  });

  return snapshot;
}

/**
 * Restore brain context from the latest snapshot.
 * Used when the system starts fresh and needs to remember where it left off.
 */
export async function getLatestSnapshot(): Promise<BrainSnapshot | null> {
  const event = await prisma.auditEvent.findFirst({
    where: { eventType: "brain_snapshot" },
    orderBy: { createdAt: "desc" },
    select: { payload: true },
  });

  if (!event?.payload) return null;
  return event.payload as unknown as BrainSnapshot;
}

/**
 * Get brain continuity summary — enhanced with drift detection.
 * Used to inject into Nick's system prompt for instant context.
 */
export async function getBrainContinuitySummary(): Promise<string | null> {
  const snapshot = await getLatestSnapshot();
  if (!snapshot) return null;

  const s = snapshot.state;
  const lines: string[] = [];
  const snapshotAge = Math.round((Date.now() - new Date(snapshot.timestamp).getTime()) / 3600000);

  lines.push(`# BRAIN CONTINUITY${snapshotAge > 24 ? " ⚠️STALE" : ""} (${snapshotAge}h ago)`);
  lines.push(`State: ${s.memoryCount} memories (${(s.brainHealth.avgConfidence * 100).toFixed(0)}% confidence), ${s.activeAlerts} alerts, ${s.openLoops} active tasks, ${s.activeCommitments} commitments`);

  if (s.recentScores.length > 0) {
    const latest = s.recentScores[0];
    lines.push(`Last score: ${latest.score}/10 on ${latest.date}`);
  }

  if (s.lastConversationTopics.length > 0) {
    lines.push(`Recent topics: ${s.lastConversationTopics.join(", ")}`);
  }

  const topPages = Object.entries(s.pageVisitPatterns).sort(([,a],[,b]) => b - a).slice(0, 3);
  if (topPages.length > 0) {
    lines.push(`Focus areas: ${topPages.map(([p, c]) => `${p}(${c})`).join(", ")}`);
  }

  // ── Session drift detection ──
  // Compare current state to snapshot state to detect drift
  try {
    const [currentLoops, currentAlerts, currentCommitments] = await Promise.all([
      prisma.task.count({ where: { deletedAt: null, status: { in: ["INBOX", "READY", "DOING"] } } }).catch(() => 0),
      (async () => {
        const { getUnresolvedAlerts } = await import("@/lib/mastery/drift-engine");
        return (await getUnresolvedAlerts().catch(() => [])).length;
      })(),
      prisma.commitment.count({ where: { deletedAt: null, status: { in: ["active", "in_progress"] } } }).catch(() => 0),
    ]);

    const loopDrift = currentLoops - s.openLoops;
    const alertDrift = currentAlerts - s.activeAlerts;
    const commitDrift = currentCommitments - s.activeCommitments;

    const drifts: string[] = [];
    if (loopDrift > 3) drifts.push(`+${loopDrift} new loops since last snapshot`);
    if (alertDrift > 2) drifts.push(`+${alertDrift} new alerts`);
    if (commitDrift > 3) drifts.push(`+${commitDrift} new commitments`);
    if (loopDrift < -3) drifts.push(`${Math.abs(loopDrift)} loops closed — good progress`);

    if (drifts.length > 0) {
      lines.push(`SESSION DRIFT: ${drifts.join(". ")}`);
    }

    // Continuity score: how stable is the system between sessions?
    const totalChange = Math.abs(loopDrift) + Math.abs(alertDrift) + Math.abs(commitDrift);
    const continuityScore = Math.max(0, 100 - totalChange * 5);
    if (continuityScore < 50) {
      lines.push(`⚠️ Low continuity (${continuityScore}/100) — significant state changes since last session. Reorient before acting.`);
    }
  } catch (e) {
    logError("brain.cloud-memory", e, { stage: "continuity-score" }, "warn");
  }

  return lines.join("\n");
}

/**
 * Detect contradictions between current state and stored memories.
 * Finds cases where what Nick "knows" doesn't match reality.
 */
export async function detectContradictions(): Promise<string[]> {
  const contradictions: string[] = [];

  try {
    const [storedRevTarget, storedReviewCount, storedTechCount] = await Promise.all([
      prisma.brainMemory.findFirst({
        where: { content: { contains: "revenue target" } },
        orderBy: { updatedAt: "desc" },
        select: { content: true },
      }).catch(() => null),
      prisma.brainMemory.findFirst({
        where: { content: { contains: "reviews" } },
        orderBy: { updatedAt: "desc" },
        select: { content: true },
      }).catch(() => null),
      prisma.brainMemory.findFirst({
        where: { category: BRAIN_CATEGORIES.STAFF_EFFICIENCY },
        orderBy: { updatedAt: "desc" },
        select: { content: true },
      }).catch(() => null),
    ]);

    // Check for stale data in memories
    if (storedRevTarget?.content.includes("$15K") || storedRevTarget?.content.includes("$10K")) {
      contradictions.push("Revenue target memory may be stale — current target is $20K");
    }

    if (storedReviewCount?.content.includes("1,500") || storedReviewCount?.content.includes("1,600")) {
      contradictions.push("Review count memory is stale — current count is 1,700+");
    }
  } catch (e) {
    logError("brain.cloud-memory", e, { stage: "contradiction-check" }, "warn");
  }

  return contradictions;
}
