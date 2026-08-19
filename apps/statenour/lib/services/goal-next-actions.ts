/**
 * lib/services/goal-next-actions.ts · Phase WW (2026-05-22 ·
 * legacy-modernizer REST→tRPC actions slice).
 *
 * For each ACTIVE LifeGoal that's behind pace, surfaces the single
 * sharpest next physical action. Extracted verbatim from the inline
 * GET /api/goals/next-actions route handler so the legacy REST route
 * AND the new `task.goalNextActions` tRPC procedure call the SAME
 * function · drift structurally impossible.
 *
 * "Behind pace" = progress < (days elapsed / days total) × 100, by
 * ≥10 points. Goals on or near pace are silent. No AI call.
 */

import { prisma } from "@/lib/prisma";

const ACTIONABLE_VERBS =
  /\b(call|email|text|book|schedule|order|finalize|sign|sketch|draft|measure|paint|install|deliver|pickup|run|refactor|deploy|publish)\b/i;

export interface GoalNextAction {
  goalId: string;
  goalTitle: string;
  domain: string;
  /** negative = behind, positive = ahead */
  paceDelta: number;
  source: "task" | "memory" | "default";
  text: string;
  /** Optional supporting context (task id, memory id, etc). */
  refId: string | null;
}

export interface GoalNextActionsResult {
  generatedAt: string;
  behindPaceCount: number;
  nextActions: GoalNextAction[];
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

/**
 * @param limit max nudges to return · clamped to 1..20 (default 5).
 */
export async function buildGoalNextActions(
  limit = 5,
): Promise<GoalNextActionsResult> {
  const cappedLimit = Math.min(Math.max(limit, 1), 20);
  const now = Date.now();

  const goals = (await prisma.lifeGoal.findMany({
    where: { status: "active", deletedAt: null },
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
        orderBy: [{ autoPriority: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
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
      const deadlineMs =
        g.deadline?.getTime() ?? g.createdAt.getTime() + 30 * 86_400_000;
      const totalMs = Math.max(1, deadlineMs - g.createdAt.getTime());
      const elapsedMs = Math.max(0, now - g.createdAt.getTime());
      const expectedProgress = Math.min(100, (elapsedMs / totalMs) * 100);
      const paceDelta = g.progress - expectedProgress;
      return { goal: g, paceDelta };
    })
    .filter((s) => s.paceDelta < -10)
    .sort((a, b) => a.paceDelta - b.paceDelta)
    .slice(0, cappedLimit);

  const memoryDomains = scored
    .filter((s) => (s.goal.tasks?.length ?? 0) === 0)
    .map((s) => s.goal.domain);

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

  const nextActions: GoalNextAction[] = scored.map(({ goal, paceDelta }) => {
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
}
