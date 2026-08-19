/**
 * GET /api/goals/next-actions
 *
 * v8.9 BATCH 54 · Apr 29.
 *
 * For each ACTIVE LifeGoal that's behind pace, surface the single
 * sharpest next physical action — pulled from:
 *   1. The goal's existing `tasks` relation (highest-priority
 *      INBOX/READY/DOING task), OR
 *   2. If no linked task, the most recent BrainMemory in the
 *      goal's domain that contains an actionable verb.
 *
 * "Behind pace" = progress < (days elapsed / days total) × 100.
 * Goals on or ahead of pace are silent (no nudge).
 *
 * Returns up to 5 nudges per call; the UI card on /plan and HQ
 * picks the top 3 to render.
 *
 * Composes:
 *   · v7.9 LifeGoal soft-delete (filters deletedAt: null)
 *   · v7.6 Task.autoPriority for ranking the linked-task candidate
 *   · No AI call — deterministic, fast, cacheable
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";

const ACTIONABLE_VERBS = /\b(call|email|text|book|schedule|order|finalize|sign|sketch|draft|measure|paint|install|deliver|pickup|run|refactor|deploy|publish)\b/i;

interface NextAction {
  goalId: string;
  goalTitle: string;
  domain: string;
  paceDelta: number;          // negative = behind, positive = ahead
  source: "task" | "memory" | "default";
  text: string;
  /** Optional supporting context (task id, memory id, etc). */
  refId: string | null;
}

interface GoalRow {
  id: string;
  title: string;
  domain: string;
  status: string;
  progress: number;
  deadline: Date | null;
  createdAt: Date;
  tasks?: Array<{
    id: string;
    title: string;
    status: string;
    autoPriority: number | null;
    nextPhysicalAction: string | null;
  }>;
}

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 5, 1), 20);

  const now = Date.now();
  const goals = (await prisma.lifeGoal.findMany({
    where: {
      status: "active",
      deletedAt: null,
    },
    select: {
      id: true,
      title: true,
      domain: true,
      status: true,
      progress: true,
      deadline: true,
      createdAt: true,
      tasks: {
        where: {
          deletedAt: null,
          status: { in: ["INBOX", "READY", "DOING"] },
        },
        orderBy: [{ autoPriority: "desc" }, { createdAt: "desc" }],
        take: 1,
        select: {
          id: true,
          title: true,
          status: true,
          autoPriority: true,
          nextPhysicalAction: true,
        },
      },
    },
  })) as GoalRow[];

  // Compute pace delta. Goals without deadline use 30d as a default
  // horizon so we don't lose them entirely from the suggester.
  const scored = goals
    .map((g) => {
      const deadlineMs = g.deadline?.getTime() ?? g.createdAt.getTime() + 30 * 86_400_000;
      const totalMs = Math.max(1, deadlineMs - g.createdAt.getTime());
      const elapsedMs = Math.max(0, now - g.createdAt.getTime());
      const expectedProgress = Math.min(100, (elapsedMs / totalMs) * 100);
      const paceDelta = g.progress - expectedProgress;
      return { goal: g, paceDelta };
    })
    // Behind pace by ≥10 points only — skip nudges for goals that
    // are barely behind (avoids noise).
    .filter((s) => s.paceDelta < -10)
    // Worst-pace first
    .sort((a, b) => a.paceDelta - b.paceDelta)
    .slice(0, limit);

  const memoryDomains = scored
    .filter((s) => (s.goal.tasks?.length ?? 0) === 0)
    .map((s) => s.goal.domain);

  // Pull recent actionable memories for goals without linked tasks.
  const memoryFallback = memoryDomains.length
    ? await prisma.brainMemory
        .findMany({
          where: {
            category: { in: ["pattern", "lesson", "insight"] },
            content: { contains: "" },
            deletedAt: null,
          },
          orderBy: { confidence: "desc" },
          take: 50,
          select: { id: true, content: true, metadata: true },
        })
        .catch((): never[] => [])
    : [];

  const nextActions: NextAction[] = scored.map(({ goal, paceDelta }) => {
    const task = goal.tasks?.[0];
    if (task) {
      return {
        goalId: goal.id,
        goalTitle: goal.title,
        domain: goal.domain,
        paceDelta,
        source: "task" as const,
        text: task.nextPhysicalAction ?? task.title,
        refId: task.id,
      };
    }
    // Fallback: pick a memory whose content has an actionable verb
    // and (loosely) mentions the domain. Cheap heuristic.
    const candidate = memoryFallback.find(
      (m) =>
        ACTIONABLE_VERBS.test(m.content) &&
        m.content.toLowerCase().includes(goal.domain.toLowerCase()),
    );
    if (candidate) {
      return {
        goalId: goal.id,
        goalTitle: goal.title,
        domain: goal.domain,
        paceDelta,
        source: "memory" as const,
        text: candidate.content.slice(0, 200),
        refId: candidate.id,
      };
    }
    // Nothing matched — fall back to a generic prompt so the card
    // never shows "no next action" for a behind-pace goal.
    return {
      goalId: goal.id,
      goalTitle: goal.title,
      domain: goal.domain,
      paceDelta,
      source: "default" as const,
      text: `Pick the smallest 5-min step toward "${goal.title.slice(0, 80)}" and do it now.`,
      refId: null,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    behindPaceCount: scored.length,
    nextActions,
  };
}, { auth: "owner" }); // v10.0.37 — was unauthed (gate widened in same commit)
