/**
 * GET /api/tasks/next-move · Wave 24 (v10.0.529.80) · #4
 *
 * Returns Nick's "what to do now" read for the operator. Composed of:
 *   · weakestDomain  · the mastery domain with the lowest score
 *  ·  rationale       · 1-sentence "why this matters today"
 *   · suggestions    · up to 3 candidate tasks pulled from existing
 *                      INBOX tasks that match the weakest domain ·
 *                      OR from BrainMemory(task_pattern) threads ·
 *                      OR a generic "create a daily task on this
 *                      axis" fallback
 *
 * Fast · zero LLM calls · pure database queries + ranking. Future v25
 * could add an LLM call to refine the rationale + suggestion text.
 *
 * Used by <NextMoveCard> mounted at the top of NOW mode on /tasks.
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import type { MissionDomain } from "@prisma/client";

/** Valid Prisma MissionDomain enum members. Used to safely narrow a
 *  free-text mastery domain back into the enum for inbox queries.
 *  v10.0.529.80 · Wave 24. */
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

export const dynamic = "force-dynamic";

interface Suggestion {
  /** "existing-inbox" · "pattern-thread" · "create-daily" · "create-once" */
  source: string;
  title: string;
  taskId?: string;
  reason: string;
}

export const GET = apiHandler(
  async () => {
    // 1 · Find the weakest domain · sort mastery scores ascending,
    //     pick the latest row per domain.
    // v-truth · 14-day floor (mirror of lib/services/next-move.ts) — don't
    // surface a fossil mastery score ("financial 2/100") stamped "today".
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
      .catch((): Array<{ domain: string; score: number; delta: number; date: string }> => []);

    if (latestScores.length === 0) {
      return {
        weakestDomain: null,
        rationale: null,
        suggestions: [],
      };
    }

    // Reduce to latest score per domain.
    const latestByDomain = new Map<string, { score: number; delta: number; date: string }>();
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
      return {
        weakestDomain: null,
        rationale: null,
        suggestions: [],
      };
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

    // 3 · Gather suggestions:
    //     a) INBOX/READY tasks already tagged with the weak domain
    //     b) BrainMemory(task_pattern) thread for the weak axis
    //     c) Generic fallback
    const suggestions: Suggestion[] = [];

    const inboxMatch = await (async () => {
      const enumDomain = asMissionDomain(weakestDomain);
      if (!enumDomain) return [] as Array<{ id: string; title: string; roiScore: number }>;
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

    // Pattern thread fallback · if we have less than 3 suggestions and
    // there's a recent pattern cluster, surface its dominant wisdom
    // query as a thread to pull.
    if (suggestions.length < 3) {
      const pattern = await prisma.brainMemory
        .findFirst({
          where: {
            category: "task_pattern",
            deletedAt: null,
          },
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

    // Generic fallback · always add at least one creator prompt so
    // the card never goes empty when scores exist but inbox is bare.
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
  },
  { auth: "owner" },
);
