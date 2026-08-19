/**
 * Actions-brain service · Phase PP (2026-05-19 AM).
 *
 * Single source of truth for the /tasks page's brain panel ·
 * pattern-detection over (DAILY task streaks · open tasks ·
 * commitments · brain memories · mastery decisions · decision
 * replays) producing the streak map + insight list + daily-focus
 * line. No LLM calls · pure rules over Prisma data.
 *
 * Called by BOTH the legacy REST handler at
 * `app/api/actions-brain/route.ts` AND the new `trpc.task.actionsBrain`
 * procedure · drift between consumers structurally impossible.
 *
 * Phase PP · extracted the 100+ lines of inline route logic into this
 * service module so the tRPC migration could plug in cleanly.
 */

import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logger } from "@/lib/logger";

export interface StreakSnapshot {
  current: number;
  best: number;
  trend: "up" | "down" | "flat";
  todayDone: boolean;
}

export type InsightKind = "info" | "warning" | "success" | "action";

export interface ActionsBrainView {
  ok: true;
  data: {
    maturity: number | null;
    weakAxis: string | null;
    streaks: Record<string, StreakSnapshot>;
    insights: Array<{ text: string; type: InsightKind; priority: number }>;
    dailyFocus: string;
    stats: {
      openTasks: number;
      activeCommitments: number;
      brainMaturity: number | null;
      weakestAxis: string | null;
      dueReplays: number;
    };
    relevantMemories: string[];
    overdueTasks: Array<{ id: string; title: string; age: number }>;
  };
}

export async function buildActionsBrain(): Promise<ActionsBrainView> {
  const [
    dailyTasks,
    identitySnap,
    commitments,
    tasks,
    memories,
    dueReplays,
  ] = await Promise.all([
    prisma.task.findMany({
      where: { loopKind: "DAILY", status: { in: ["READY", "DOING"] }, deletedAt: null },
      select: { title: true, streakCount: true, lastCompletedAt: true },
    }).catch((err) => {
      logger.warn("actions_brain_daily_tasks_failed", {
        error: err instanceof Error ? err.message.slice(0, 120) : String(err),
      });
      return [] as Array<{ title: string; streakCount: number; lastCompletedAt: Date | null }>;
    }),
    prisma.brainMemory
      .findUnique({
        where: { category_key: { category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT, key: "current" } },
        select: { content: true, deletedAt: true },
      })
      .then((r) => (r && r.deletedAt ? null : r))
      .catch(() => null),
    prisma.commitment.findMany({ where: { status: { in: ["active", "in_progress"] }, deletedAt: null } }),
    prisma.task.findMany({
      where: { status: { in: ["INBOX", "READY", "DOING"] }, deletedAt: null },
      include: { mission: { select: { title: true, domain: true } } },
      orderBy: { autoPriority: { sort: "desc", nulls: "last" } },
    }),
    prisma.brainMemory.findMany({
      where: { category: { in: ["lesson", "pattern", "insight"] }, deletedAt: null },
      orderBy: { confidence: "desc" },
      take: 10,
    }),
    prisma.decisionReplay.findMany({
      where: { reviewed: false, reviewAt: { lte: new Date() } },
      take: 5,
    }),
  ]);

  // Streak analysis (from DAILY Task streakCount)
  const streakMap: Record<string, StreakSnapshot> = {};
  for (const t of dailyTasks) {
    const daysSince = t.lastCompletedAt
      ? (Date.now() - t.lastCompletedAt.getTime()) / 86400_000
      : 999;
    const todayDone = daysSince < 1;
    const trend: "up" | "down" | "flat" =
      t.streakCount >= 7 ? "up" : t.streakCount >= 3 ? "flat" : "down";
    streakMap[t.title] = {
      current: t.streakCount,
      best: t.streakCount,
      trend,
      todayDone,
    };
  }

  const insights: Array<{ text: string; type: InsightKind; priority: number }> = [];

  const weakHabits = Object.entries(streakMap).filter(
    ([, v]) => v.trend === "down" && !v.todayDone,
  );
  if (weakHabits.length > 0) {
    insights.push({
      text: `${weakHabits.map(([k]) => k).join(", ")} trending down — do them NOW before the day gets away`,
      type: "warning",
      priority: 1,
    });
  }

  const overdueTasks = tasks.filter((t) => {
    const age = Math.floor((Date.now() - new Date(t.createdAt).getTime()) / 86400000);
    return age > 7;
  });
  if (overdueTasks.length > 3) {
    insights.push({
      text: `${overdueTasks.length} tasks overdue — either do them, delegate them, or delete them. Carrying dead tasks kills momentum.`,
      type: "action",
      priority: 2,
    });
  }

  if (commitments.length > 12) {
    insights.push({
      text: `${commitments.length} active commitments — too many. Pick the top 5 that actually matter. Mark the rest as kept or broken.`,
      type: "warning",
      priority: 3,
    });
  }

  let maturity: number | null = null;
  let weakAxis: string | null = null;
  if (identitySnap?.content) {
    try {
      const snap = JSON.parse(identitySnap.content) as {
        axes: Record<string, { value: number; manual: number | null }>;
      };
      const axes = Object.entries(snap.axes ?? {});
      if (axes.length > 0) {
        maturity = Math.round(
          axes.reduce((s, [, a]) => s + (a.manual ?? a.value), 0) / axes.length,
        );
        const weak = [...axes].sort(
          ([, a], [, b]) => (a.manual ?? a.value) - (b.manual ?? b.value),
        )[0];
        if (weak && (weak[1].manual ?? weak[1].value) < 40) {
          weakAxis = weak[0];
        }
      }
    } catch {
      // skip
    }
  }
  if (maturity !== null && maturity < 40) {
    insights.push({
      text: `Brain maturity at ${maturity}/100 — self-model is thin. Open /brain · review candidates + identity pins.`,
      type: "info",
      priority: 4,
    });
  }
  if (weakAxis) {
    insights.push({
      text: `Weakest axis: ${weakAxis}. Focus this week on the behaviors that move it.`,
      type: "warning",
      priority: 4,
    });
  }

  const hotStreaks = Object.entries(streakMap).filter(([, v]) => v.current >= 7);
  if (hotStreaks.length > 0) {
    insights.push({
      text: `Protect these streaks: ${hotStreaks.map(([k, v]) => `${k} (${v.current}d 🔥)`).join(", ")}`,
      type: "success",
      priority: 5,
    });
  }

  if (dueReplays.length > 0) {
    insights.push({
      text: `${dueReplays.length} decision${dueReplays.length > 1 ? "s" : ""} due for replay review — reflect on past choices`,
      type: "info",
      priority: 6,
    });
  }

  let dailyFocus = "Complete your non-negotiable routines first.";
  if (weakHabits.length > 0) dailyFocus = `Fix this first: ${weakHabits[0][0]} is slipping.`;
  else if (overdueTasks.length > 0)
    dailyFocus = `Clear the oldest overdue task: "${overdueTasks[0].title}"`;
  else if (maturity !== null && maturity >= 70)
    dailyFocus = "Brain maturity solid — tackle something hard.";

  const relevantMemories = memories.slice(0, 3).map((m) => m.content.slice(0, 100));

  return {
    ok: true,
    data: {
      maturity,
      weakAxis,
      streaks: streakMap,
      insights: insights.sort((a, b) => a.priority - b.priority),
      dailyFocus,
      stats: {
        openTasks: tasks.length,
        activeCommitments: commitments.length,
        brainMaturity: maturity,
        weakestAxis: weakAxis,
        dueReplays: dueReplays.length,
      },
      relevantMemories,
      overdueTasks: overdueTasks.slice(0, 3).map((t) => ({
        id: t.id,
        title: t.title,
        age: Math.floor((Date.now() - new Date(t.createdAt).getTime()) / 86400000),
      })),
    },
  };
}
