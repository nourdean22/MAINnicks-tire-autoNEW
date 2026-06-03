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

export interface NextMove {
  weakestDomain: string | null;
  weakestScore?: number;
  weakestDelta?: number;
  rationale: string | null;
  suggestions: NextMoveSuggestion[];
}

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

  return {
    weakestDomain,
    weakestScore: weakestData.score,
    weakestDelta: weakestData.delta,
    rationale,
    suggestions: suggestions.slice(0, 3),
  };
}
