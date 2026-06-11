/**
 * lib/services/today-compound.ts · Phase WW (2026-05-22 ·
 * legacy-modernizer REST→tRPC actions slice).
 *
 * Builds today's compounded auto-learn signal · the 1-row "today's
 * growth" strip above the /tasks work surface. Extracted verbatim
 * from the inline GET /api/tasks/today-compound route handler so the
 * legacy REST route AND the new `task.todayCompound` tRPC procedure
 * call the SAME function · drift structurally impossible.
 *
 * Pure read · 7 small Prisma queries · zero LLM cost · safe to poll
 * on a 60s interval.
 */

import { prisma } from "@/lib/prisma";
import {
  today as todayET,
  startOfDay as etDayStart,
  endOfDay as etDayEnd,
} from "@/lib/utils/datetime";

export interface TodayCompound {
  date: string;
  masteryTotal: number;
  masteryByDomain: Record<string, { score: number; delta: number }>;
  topMastery: { domain: string; score: number; delta: number } | null;
  insightCount: number;
  wisdomCount: number;
  learnCount: number;
  goalsLifted: number;
  focusedMinutes: number;
  tasksDone: number;
  tasksOpen: number;
}

export async function buildTodayCompound(): Promise<TodayCompound> {
  const date = todayET();
  // Day bounds (UTC instants) for the ET calendar day `date`. The
  // noon-UTC anchor lands unambiguously inside that ET day whatever
  // the offset is.
  const anchor = new Date(`${date}T12:00:00Z`);
  const startOfDay = etDayStart(anchor);
  const endOfDay = etDayEnd(anchor);

  const [
    masteryRows,
    insightCount,
    learnCount,
    goalsLifted,
    todaysDone,
    tasksOpen,
  ] = await Promise.all([
    prisma.masteryScore
      .findMany({
        where: { date },
        select: { domain: true, score: true, delta: true },
      })
      .catch(() => []),
    prisma.brainMemory
      .count({
        where: {
          category: "task_insight",
          createdAt: { gte: startOfDay, lte: endOfDay },
          deletedAt: null,
        },
      })
      .catch(() => 0),
    prisma.brainMemory
      .count({
        where: {
          category: "learn_complete",
          createdAt: { gte: startOfDay, lte: endOfDay },
          deletedAt: null,
        },
      })
      .catch(() => 0),
    prisma.goalEvent
      .groupBy({
        by: ["goalId"],
        where: {
          kind: "progress_logged",
          createdAt: { gte: startOfDay, lte: endOfDay },
        },
      })
      .then((rows) => rows.length)
      .catch(() => 0),
    prisma.task
      .findMany({
        where: {
          status: "DONE",
          updatedAt: { gte: startOfDay, lte: endOfDay },
          deletedAt: null,
        },
        select: { actualMinutes: true },
      })
      .catch((): Array<{ actualMinutes: number }> => []),
    prisma.task
      .count({
        where: {
          status: { in: ["INBOX", "READY", "DOING"] },
          deletedAt: null,
        },
      })
      .catch(() => 0),
  ]);

  const masteryTotal = masteryRows.reduce((sum, r) => sum + (r.delta || 0), 0);
  const masteryByDomain: Record<string, { score: number; delta: number }> = {};
  for (const r of masteryRows) {
    masteryByDomain[r.domain] = { score: r.score, delta: r.delta };
  }

  const topMastery =
    masteryRows
      .filter((r) => (r.delta || 0) > 0)
      .sort((a, b) => (b.delta || 0) - (a.delta || 0))[0] ?? null;

  const focusedMinutes = todaysDone.reduce(
    (sum, t) => sum + (t.actualMinutes || 0),
    0,
  );

  // wisdomCount can't be directly counted (toast-only · not persisted).
  // Count insights that have a non-null wisdom_query in their metadata.
  const wisdomMatchedRows = await prisma.brainMemory
    .findMany({
      where: {
        category: "task_insight",
        createdAt: { gte: startOfDay, lte: endOfDay },
        deletedAt: null,
      },
      select: { metadata: true },
      take: 200,
    })
    .catch((): Array<{ metadata: unknown }> => []);
  const wisdomCount = wisdomMatchedRows.filter((r) => {
    try {
      const m = r.metadata as { wisdom_query?: string | null } | null;
      return !!m?.wisdom_query;
    } catch {
      return false;
    }
  }).length;

  return {
    date,
    masteryTotal: Math.round(masteryTotal * 10) / 10,
    masteryByDomain,
    topMastery: topMastery
      ? {
          domain: topMastery.domain,
          score: topMastery.score,
          delta: topMastery.delta,
        }
      : null,
    insightCount,
    wisdomCount,
    learnCount,
    goalsLifted,
    focusedMinutes,
    tasksDone: todaysDone.length,
    tasksOpen,
  };
}
