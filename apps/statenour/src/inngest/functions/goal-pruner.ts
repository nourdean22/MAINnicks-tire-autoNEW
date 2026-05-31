/**
 * goal-pruner · Phase A.1 (2026-05-17)
 *
 * Daily Inngest cron · scans LifeGoal + GoalEvent · flags stale goals
 * (no movement 30+ days) as pruning candidates for operator review.
 *
 * Pattern:
 *   1. Read active goals + their most recent GoalEvent
 *   2. Identify goals with no event in 30+ days
 *   3. Upsert BrainMemory(category="goal_prune_candidate", key=goalId)
 *   4. Clean up rows for goals that have since had activity
 *
 * Trigger: cron 0 12 * * * (12:00 UTC = 8am ET) · runs after morning
 * brief so any stale flags surface in the /goals page when the operator
 * actually opens it.
 *
 * Concurrency: 1 · this is a single read+write batch · no fan-out needed.
 *
 * The /goals page reads these rows + decorates the goal cards with a
 * "stale · review" badge + the header surfaces the total count with a
 * deep-link to chat for the actual pruning conversation.
 *
 * See: ADR-0010 · lib/brain/categories.ts (GOAL_PRUNE_CANDIDATE)
 */

import { getInngest } from "../client";
import { onInngestFailure } from "../on-failure";
import { logger as rootLogger } from "@/lib/logger";
import { recordCoachEvent, ackCoachEvent, buildCoachEventKey } from "@/lib/services/coach-events";

const log = rootLogger.withSurface("inngest/goal-pruner");
const inngest = getInngest();

const STALE_THRESHOLD_DAYS = 30;

interface PruneCandidate {
  goalId: string;
  goalTitle: string;
  horizon: string | null;
  daysSinceActivity: number;
}

async function scanForStaleGoals(): Promise<{
  flagged: PruneCandidate[];
  cleared: string[]; // goalIds where activity resumed
}> {
  const { prisma } = await import("@/lib/prisma");
  const { activeOnly } = await import("@/lib/db/soft-delete");

  // Active goals + most recent GoalEvent per goal
  const goals = await prisma.lifeGoal.findMany({
    where: activeOnly({ status: { in: ["active", "in_progress"] } }),
    select: {
      id: true,
      title: true,
      horizon: true,
      updatedAt: true,
      events: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });

  const flagged: PruneCandidate[] = [];
  const stillFreshIds = new Set<string>();
  const now = Date.now();

  for (const g of goals) {
    const lastActivity = g.events[0]?.createdAt ?? g.updatedAt;
    const daysSince = Math.floor((now - new Date(lastActivity).getTime()) / 86_400_000);
    if (daysSince >= STALE_THRESHOLD_DAYS) {
      flagged.push({
        goalId: g.id,
        goalTitle: g.title,
        horizon: g.horizon,
        daysSinceActivity: daysSince,
      });
    } else {
      stillFreshIds.add(g.id);
    }
  }

  // Find existing prune-candidate rows that are now fresh (operator moved
  // the goal since last scan) and clear them.
  const existing = await prisma.brainMemory.findMany({
    where: { category: "goal_prune_candidate", deletedAt: null },
    select: { key: true },
  });
  const cleared = existing
    .map((r) => r.key)
    .filter((k): k is string => Boolean(k) && stillFreshIds.has(k));

  return { flagged, cleared };
}

async function persistFlags(flagged: PruneCandidate[]): Promise<void> {
  if (flagged.length === 0) return;
  const { prisma } = await import("@/lib/prisma");
  const { Prisma } = await import("@prisma/client");
  const ops = flagged.map((c) => {
    // Prisma's InputJsonValue is strict · cast through (pure data,
    // safe JSON round-trip · same pattern as customer-preferences.ts)
    const metadata = c as unknown as typeof Prisma.JsonNull | object;
    return prisma.brainMemory.upsert({
      where: { category_key: { category: "goal_prune_candidate", key: c.goalId } },
      create: {
        category: "goal_prune_candidate",
        key: c.goalId,
        content: `${c.goalTitle} · ${c.horizon ?? "no-horizon"} · ${c.daysSinceActivity}d idle`,
        confidence: 0.9,
        source: "inngest/goal-pruner",
        metadata: metadata as never,
      },
      update: {
        content: `${c.goalTitle} · ${c.horizon ?? "no-horizon"} · ${c.daysSinceActivity}d idle`,
        metadata: metadata as never,
      },
    });
  });
  await Promise.all(ops);

  // Mastery Layer Stage A · dual-write to the unified coach channel
  // (commit d0ced3e0 · lib/services/coach-events.ts). The original
  // goal_prune_candidate write stays for now · /goals page reads from
  // it directly. Once the CoachEventBanner consumer lands on /goals
  // (follow-up commit), the original write can be retired.
  //
  // recordCoachEvent fire-and-forget — its own catch + log handles
  // failure · the cron's primary store (goal_prune_candidate above)
  // is the source of truth during the migration window.
  await Promise.all(
    flagged.map((c) =>
      recordCoachEvent({
        kind: "prune-candidate",
        subjectId: c.goalId,
        priority: "P2", // stale-flag is advisory, not urgent
        title: `Stale goal · ${c.goalTitle} · ${c.daysSinceActivity}d idle`,
        body: `No activity for ${c.daysSinceActivity} days — tap to review or archive at the goal.`,
        deepLink: `/stats#goal-${encodeURIComponent(c.goalId)}`,
        surfaces: ["goals"],
        extra: { goalTitle: c.goalTitle, horizon: c.horizon, daysSinceActivity: c.daysSinceActivity },
      }),
    ),
  );
}

async function clearFreshRows(cleared: string[]): Promise<void> {
  if (cleared.length === 0) return;
  const { prisma } = await import("@/lib/prisma");
  await prisma.brainMemory.updateMany({
    where: { category: "goal_prune_candidate", key: { in: cleared } },
    data: { deletedAt: new Date() },
  });

  // Mastery Layer Stage A · also ack the coach-channel mirror so the
  // /goals CoachEventBanner stops surfacing the stale-flag once the
  // goal has activity again. Ack-not-delete preserves the event
  // history in case the operator wants to see what was acted on.
  await Promise.all(
    cleared.map((goalId) =>
      ackCoachEvent(buildCoachEventKey("prune-candidate", goalId)).catch(() => false),
    ),
  );
}

export const goalPruner = inngest.createFunction(
  {
    id: "goal-pruner",
    name: "Goal pruner · daily stale-goal flagger",
    retries: 2,
    triggers: [{ cron: "0 12 * * *" }],
    onFailure: onInngestFailure,
  },
  async ({ step }) => {
    const { flagged, cleared } = await step.run("scan-stale-goals", () =>
      scanForStaleGoals(),
    );
    await step.run("persist-flags", () => persistFlags(flagged));
    await step.run("clear-fresh-rows", () => clearFreshRows(cleared));

    log.info("goal_pruner_done", {
      flagged: flagged.length,
      cleared: cleared.length,
    });

    return {
      flaggedCount: flagged.length,
      clearedCount: cleared.length,
      thresholdDays: STALE_THRESHOLD_DAYS,
      // Sample for dashboard visibility
      samples: flagged.slice(0, 3).map((f) => ({
        title: f.goalTitle.slice(0, 60),
        horizon: f.horizon,
        days: f.daysSinceActivity,
      })),
    };
  },
);
