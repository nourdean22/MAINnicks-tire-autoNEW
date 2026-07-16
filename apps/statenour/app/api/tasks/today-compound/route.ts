/**
 * GET /api/tasks/today-compound · Wave 23 (v10.0.529.79) · #1
 *
 * Returns today's compounded auto-learn signal so the /tasks page can
 * show a 1-row "today's growth" strip above the work surface. Operator
 * SEES their work compounding in real time instead of having to
 * navigate to /mastery to spot the lift.
 *
 * Response shape:
 *   {
 *     date: "2026-05-15",
 *     masteryDelta: { domain: number } | total,
 *     insightCount: number,    // task_insight rows created today
 *     wisdomCount:  number,    // unique wisdom citations matched
 *     learnCount:   number,    // tutorial completions today
 *     goalsLifted:  number,    // goals with GoalEvent(progress_logged) today
 *     focusedMinutes: number,  // sum of Task.actualMinutes for today's DONE
 *     tasksDone:    number,
 *     tasksOpen:    number,
 *   }
 *
 * Caching: response is set to dynamic · cache: "no-store" on the
 * client. The Tasks page polls every 60s via existing data-change
 * events · this endpoint is read-only + cheap (5 small queries).
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import {
  today as todayET,
  startOfDay as etDayStart,
  endOfDay as etDayEnd,
} from "@/lib/utils/datetime";

export const dynamic = "force-dynamic";

export const GET = apiHandler(
  async () => {
    const date = todayET();
    // Day bounds (UTC instants) for the ET calendar day `date`. The
    // noon-UTC anchor lands unambiguously inside that ET day whatever
    // the offset is — the prior hardcoded -04:00 ran an hour off all
    // winter (EST is -05:00), so the strip dropped early-morning rows.
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
      // Mastery deltas for today
      prisma.masteryScore
        .findMany({
          where: { date },
          select: { domain: true, score: true, delta: true },
        })
        .catch(() => []),
      // Insights created today (regex + LLM enrichment both upsert here)
      prisma.brainMemory
        .count({
          where: {
            category: "task_insight",
            createdAt: { gte: startOfDay, lte: endOfDay },
            deletedAt: null,
          },
        })
        .catch(() => 0),
      // Tutorials completed today
      prisma.brainMemory
        .count({
          where: {
            category: "learn_complete",
            createdAt: { gte: startOfDay, lte: endOfDay },
            deletedAt: null,
          },
        })
        .catch(() => 0),
      // Goals that got a progress_logged event today
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
      // Today's DONE tasks · for focusedMinutes + count. Filter on
      // lastCompletedAt (set by every completion path) — updatedAt
      // counted any DONE row merely touched today (retro sweeps,
      // metadata edits) as "done today".
      prisma.task
        .findMany({
          where: {
            status: "DONE",
            lastCompletedAt: { gte: startOfDay, lte: endOfDay },
            deletedAt: null,
          },
          select: { actualMinutes: true },
        })
        .catch((): Array<{ actualMinutes: number }> => []),
      // Open tasks · for the "X to go" badge
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

    // Top-bumped axis today · for the strip's primary chip
    const topMastery = masteryRows
      .filter((r) => (r.delta || 0) > 0)
      .sort((a, b) => (b.delta || 0) - (a.delta || 0))[0] ?? null;

    const focusedMinutes = todaysDone.reduce((sum, t) => sum + (t.actualMinutes || 0), 0);

    // wisdomCount can't be directly counted (toast-only · not persisted
    // currently). For a meaningful display we count insights that have
    // a non-null wisdom_query in their metadata · proxy for "wisdom
    // matched this task".
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
        ? { domain: topMastery.domain, score: topMastery.score, delta: topMastery.delta }
        : null,
      insightCount,
      wisdomCount,
      learnCount,
      goalsLifted,
      focusedMinutes,
      tasksDone: todaysDone.length,
      tasksOpen,
    };
  },
  { auth: "owner" },
);
