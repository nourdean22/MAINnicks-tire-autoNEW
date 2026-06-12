/**
 * lib/services/next-move.ts · Phase WW (2026-05-22 ·
 * legacy-modernizer REST→tRPC actions slice).
 *
 * Builds Nick's "what to do now" read for the operator · the
 * NextMoveCard at the top of NOW mode on /tasks. Extracted verbatim
 * from the inline GET /api/tasks/next-move route handler so the
 * legacy REST route AND the new `task.nextMove` tRPC procedure call
 * the SAME function · drift structurally impossible.
 *
 * Fast · zero LLM calls · pure Prisma queries + ranking.
 */

import { prisma } from "@/lib/prisma";
import type { MissionDomain } from "@prisma/client";

/** Valid Prisma MissionDomain enum members. Used to safely narrow a
 *  free-text mastery domain back into the enum for inbox queries. */
const KNOWN_MISSION_DOMAINS: readonly MissionDomain[] = [
  "BUSINESS",
  "PERSONAL",
  "HEALTH",
  "CONTENT",
  "FINANCE",
];

function asMissionDomain(s: string): MissionDomain | null {
  const up = s.toUpperCase();
  return (KNOWN_MISSION_DOMAINS as readonly string[]).includes(up)
    ? (up as MissionDomain)
    : null;
}

export interface NextMoveSuggestion {
  /** "existing-inbox" · "pattern-thread" · "create-daily" · "create-once" */
  source: string;
  title: string;
  taskId?: string;
  reason: string;
}

export interface CriticalFewTask {
  id: string;
  title: string;
  roiScore: number;
  effort: string;
  energyRequired: string;
  domain: string;
  lane: "focus" | "weakest" | "quick";
  reason: string;
}

export interface NextMove {
  weakestDomain: string | null;
  weakestScore?: number;
  weakestDelta?: number;
  rationale: string | null;
  suggestions: NextMoveSuggestion[];
  criticalFew?: CriticalFewTask[];
}

// ─── Stat Key to Mission Domain Map ────────────────────────────────
const STAT_KEY_TO_MISSION_DOMAIN: Record<string, string> = {
  // BODY
  physical: "HEALTH",
  combat: "HEALTH",
  conditioning: "HEALTH",
  mobility: "HEALTH",
  // MIND
  mental: "PERSONAL",
  fortitude: "PERSONAL",
  emotional_intelligence: "PERSONAL",
  adaptability: "PERSONAL",
  courage: "PERSONAL",
  faith: "PERSONAL",
  self_confidence: "PERSONAL",
  patience: "PERSONAL",
  audacity: "PERSONAL",
  wisdom: "PERSONAL",
  discipline: "PERSONAL",
  // EMPIRE
  business_ops: "BUSINESS",
  financial: "FINANCE",
  technical: "BUSINESS",
  strategy: "BUSINESS",
  delegation: "BUSINESS",
  follow_through: "BUSINESS",
  critical_thinking: "BUSINESS",
  learning: "BUSINESS",
  // INFLUENCE
  sales: "CONTENT",
  persuasion: "CONTENT",
  marketing: "CONTENT",
  leadership: "CONTENT",
  relationships: "PERSONAL",
  service: "PERSONAL",
  languages: "PERSONAL",
  advertising: "CONTENT",
  seduction: "PERSONAL",
  networking: "CONTENT",
};

export async function buildNextMove(): Promise<NextMove> {
  // 1 · Find the weakest domain · sort mastery scores ascending,
  //     pick the latest row per domain.
  // v-truth · 14-day floor. masteryScore rows are only written when a task in
  // that domain is completed, so a domain that last scored weeks ago (e.g.
  // "financial 2/100") would surface that FOSSIL value stamped "biggest
  // leverage today". Only consider recently-moved domains so "today" is honest.
  const masteryFloorStr = new Date(Date.now() - 14 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const latestScores = await prisma.masteryScore
    .findMany({
      where: { date: { gte: masteryFloorStr } },
      orderBy: { date: "desc" },
      take: 100,
      select: { domain: true, score: true, delta: true, date: true },
    })
    .catch(
      (): Array<{ domain: string; score: number; delta: number; date: string }> =>
        [],
    );

  if (latestScores.length === 0) {
    return { weakestDomain: null, rationale: null, suggestions: [] };
  }

  const latestByDomain = new Map<
    string,
    { score: number; delta: number; date: string }
  >();
  for (const row of latestScores) {
    if (!latestByDomain.has(row.domain)) {
      latestByDomain.set(row.domain, {
        score: row.score,
        delta: row.delta,
        date: row.date,
      });
    }
  }
  const entries = [...latestByDomain.entries()];
  entries.sort((a, b) => a[1].score - b[1].score);
  const weakest = entries[0];
  if (!weakest) {
    return { weakestDomain: null, rationale: null, suggestions: [] };
  }
  const [weakestDomain, weakestData] = weakest;

  // 2 · Build rationale (1-sentence).
  const rationale = (() => {
    if (weakestData.delta < 0) {
      return `${weakestDomain} drifted -${Math.abs(weakestData.delta).toFixed(1)} recently · time for a deliberate push`;
    }
    if (weakestData.score < 30) {
      return `${weakestDomain} is your weakest axis at ${weakestData.score}/100 · biggest leverage today`;
    }
    if (weakestData.score < 50) {
      return `${weakestDomain} is below 50/100 · a small move here compounds fast`;
    }
    return `${weakestDomain} hasn't moved much · pick something that lifts it`;
  })();

  // 3 · Gather suggestions.
  const suggestions: NextMoveSuggestion[] = [];

  const inboxMatch = await (async () => {
    const enumDomain = asMissionDomain(weakestDomain);
    if (!enumDomain)
      return [] as Array<{ id: string; title: string; roiScore: number }>;
    return prisma.task
      .findMany({
        where: {
          status: { in: ["INBOX", "READY"] },
          deletedAt: null,
          mission: { domain: enumDomain },
        },
        select: { id: true, title: true, roiScore: true },
        orderBy: [{ roiScore: "desc" }, { lastTouchedAt: "desc" }],
        take: 3,
      })
      .catch((): Array<{ id: string; title: string; roiScore: number }> => []);
  })();

  for (const t of inboxMatch) {
    suggestions.push({
      source: "existing-inbox",
      title: t.title,
      taskId: t.id,
      reason: `already in your inbox · ROI ${t.roiScore}`,
    });
  }

  if (suggestions.length < 3) {
    const pattern = await prisma.brainMemory
      .findFirst({
        where: { category: "task_pattern", deletedAt: null },
        orderBy: { confidence: "desc" },
        select: { metadata: true },
      })
      .catch(() => null);
    const meta = (pattern?.metadata ?? null) as {
      dominantWisdomQuery?: string | null;
      axis?: string;
    } | null;
    if (meta?.dominantWisdomQuery) {
      suggestions.push({
        source: "pattern-thread",
        title: `pull the thread · ${meta.dominantWisdomQuery}`,
        reason: meta.axis
          ? `recurring pattern on ${meta.axis}`
          : "system noticed a thread worth pulling",
      });
    }
  }

  if (suggestions.length === 0) {
    suggestions.push({
      source: "create-daily",
      title: `create a daily task that lifts ${weakestDomain}`,
      reason: "no inbox tasks match this domain yet",
    });
  }

  // 4 · Find the "Critical Few" open tasks
  const openTasks = await prisma.task.findMany({
    where: {
      status: { in: ["INBOX", "READY", "DOING"] },
      deletedAt: null,
    },
    include: {
      mission: {
        select: { domain: true },
      },
    },
    orderBy: [
      { roiScore: "desc" },
      { lastTouchedAt: "desc" },
    ],
  }).catch(() => [] as any[]);

  const criticalFew: CriticalFewTask[] = [];
  const selectedIds = new Set<string>();

  // 4.1 Focus Lane
  let focusTask = openTasks.find((t) => t.status === "DOING");
  let focusReason = "Currently in progress";

  if (!focusTask) {
    focusTask = openTasks.find((t) => t.loopKind !== "DAILY" && t.loopKind !== "WEEKLY");
    focusReason = focusTask ? `Highest ROI strategic target (ROI ${focusTask.roiScore})` : "";
  }
  if (!focusTask && openTasks.length > 0) {
    focusTask = openTasks[0];
    focusReason = focusTask ? `Highest ROI target (ROI ${focusTask.roiScore})` : "";
  }

  if (focusTask) {
    selectedIds.add(focusTask.id);
    criticalFew.push({
      id: focusTask.id,
      title: focusTask.title,
      roiScore: focusTask.roiScore,
      effort: focusTask.effort,
      energyRequired: focusTask.energyRequired,
      domain: focusTask.mission?.domain || "PERSONAL",
      lane: "focus",
      reason: focusReason,
    });
  }

  // 4.2 Weakest Lane
  if (weakestDomain) {
    const lowestDomainKey = weakestDomain.toLowerCase();
    const targetLegacyDomain = STAT_KEY_TO_MISSION_DOMAIN[lowestDomainKey] || weakestDomain;
    const weakestLaneTask = openTasks.find((t) => 
      !selectedIds.has(t.id) &&
      t.mission?.domain?.toUpperCase() === targetLegacyDomain.toUpperCase()
    );
    if (weakestLaneTask) {
      selectedIds.add(weakestLaneTask.id);
      criticalFew.push({
        id: weakestLaneTask.id,
        title: weakestLaneTask.title,
        roiScore: weakestLaneTask.roiScore,
        effort: weakestLaneTask.effort,
        energyRequired: weakestLaneTask.energyRequired,
        domain: weakestLaneTask.mission?.domain || weakestDomain,
        lane: "weakest",
        reason: `Lifts your weakest axis: ${weakestDomain}`,
      });
    }
  }

  // 4.3 Quick Lane
  const quickLaneTask = openTasks.find((t) => 
    !selectedIds.has(t.id) &&
    (t.effort === "M5" || t.effort === "M15") &&
    t.energyRequired === "LOW"
  );

  if (quickLaneTask) {
    selectedIds.add(quickLaneTask.id);
    criticalFew.push({
      id: quickLaneTask.id,
      title: quickLaneTask.title,
      roiScore: quickLaneTask.roiScore,
      effort: quickLaneTask.effort,
      energyRequired: quickLaneTask.energyRequired,
      domain: quickLaneTask.mission?.domain || "PERSONAL",
      lane: "quick",
      reason: "Low effort, low energy — build momentum",
    });
  }

  return {
    weakestDomain,
    weakestScore: weakestData.score,
    weakestDelta: weakestData.delta,
    rationale,
    suggestions: suggestions.slice(0, 3),
    criticalFew,
  };
}
