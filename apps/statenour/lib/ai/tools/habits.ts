/**
 * Habit + weekly-analysis tools.
 *
 * Includes: getHabitStreaks · weeklyReview · analyzeWeek.
 *
 * v10.0.529.106 · Wave 82 · extracted from monolithic lib/ai/tools.ts.
 * Aggregate barrel: lib/ai/tools.ts re-exports nourTools composed from
 * all 7 domain files. Catalog source of truth: lib/ai/tools/catalog.ts.
 */

import { tool } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { today, daysAgo, toDateString } from "@/lib/utils/datetime";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logError } from "@/lib/utils/error-log";
import { readBridge } from "@/lib/nickstire/query";

export const habitsTools = {
  getHabitStreaks: tool({
    description: "Get habit completion data — current streaks for daily-loop tasks (workouts, journal, etc).",
    inputSchema: z.object({}),
    execute: async () => {
      // v10.0.54 · Wave A · Replaces retired HabitLog table reads
      // (Apr 19 deprecation). Source of truth for habits is now
      // Task with loopKind="DAILY" — streakCount + lastCompletedAt
      // give the same signal: is this habit being kept on track?
      // Returns { [taskTitle]: { completed, total } } where completed
      // = streakCount and total = streakCount + missDaysSinceLast,
      // matching the legacy 7-day-window contract.
      const dailyTasks = await prisma.task
        .findMany({
          where: { loopKind: "DAILY", deletedAt: null },
          select: { title: true, streakCount: true, lastCompletedAt: true },
        })
        .catch((err): Array<{ title: string; streakCount: number; lastCompletedAt: Date | null }> => {
          logError("ai.tools-habits", err, { fn: "getHabitStreaks" });
          return [];
        });
      const summary: Record<string, { completed: number; total: number }> = {};
      for (const t of dailyTasks) {
        const completed = Math.min(7, t.streakCount); // 7-day window
        const daysSince = t.lastCompletedAt
          ? Math.floor((Date.now() - t.lastCompletedAt.getTime()) / 86400000)
          : 7;
        const missed = Math.min(7, daysSince);
        summary[t.title] = { completed, total: completed + Math.max(0, missed - completed) || 7 };
      }
      return summary;
    },
  }),

  weeklyReview: tool({
    description: "Weekly performance review — 7-day revenue trend, task completion rate, habit streaks, drift patterns, wins and misses",
    inputSchema: z.object({}),
    execute: async () => {
      const { queryNick } = await import("@/lib/nickstire/query");
      // Seven shop days including today: revenue_range's `from`/`to` are both inclusive, so
      // daysAgo(7)..today read eight (2026-10-09).
      const sevenAgo = toDateString(daysAgo(6));

      const [revenue, scoreSnapshots, tasksCompleted, tasksCreated, dailyHabits, alerts] = await Promise.all([
        queryNick("revenue_range", { from: sevenAgo, to: today() }),
        // v10.0.54 · 7-day score history → identity_snapshot rows
        // updatedAt within window. Each row's content is JSON with
        // {score, date, ...}. We extract date + score for the trend.
        prisma.brainMemory
          .findMany({
            where: {
              category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT,
              deletedAt: null,
              updatedAt: { gte: daysAgo(7) },
            },
            orderBy: { updatedAt: "desc" },
            select: { content: true, updatedAt: true },
          })
          .catch((err): null => {
            logError("ai.tools-habits", err, { fn: "weeklyReview", scope: "snapshots" });
            return null;
          }),
        // deletedAt:null on BOTH — these are the numerator and denominator of
        // the weekly completion rate reported to Nick. Filtering only one side
        // would skew the rate rather than fix it.
        prisma.task.count({ where: { status: "DONE", updatedAt: { gte: daysAgo(7) }, deletedAt: null } }).catch((err) => {
          logError("ai.tools-habits", err, { fn: "weeklyReview", scope: "tasksCompleted" });
          return null;
        }),
        prisma.task.count({ where: { createdAt: { gte: daysAgo(7) }, deletedAt: null } }).catch((err) => {
          logError("ai.tools-habits", err, { fn: "weeklyReview", scope: "tasksCreated" });
          return null;
        }),
        // v10.0.54 · habit history → DAILY-loop tasks completed in
        // last 7d. Streak count is the durable metric; we surface
        // per-task streaks as the "habits" rollup.
        prisma.task
          .findMany({
            where: {
              loopKind: "DAILY",
              deletedAt: null,
              lastCompletedAt: { gte: daysAgo(7) },
            },
            select: { title: true, streakCount: true },
          })
          .catch((err): null => {
            logError("ai.tools-habits", err, { fn: "weeklyReview", scope: "dailyHabits" });
            return null;
          }),
        prisma.brainMemory
          .findMany({
            where: {
              category: "coach_event",
              key: { startsWith: "coach:drift-recovery:" },
              createdAt: { gte: daysAgo(7) },
              deletedAt: null,
            },
            select: { metadata: true },
          })
          .catch((err): null => {
            logError("ai.tools-habits", err, { fn: "weeklyReview", scope: "alerts" });
            return null;
          }),
      ]);

      // Parse score snapshots
      const scores: Array<{ date: string; overallScore: number | null }> = [];
      // 2026-10-10 · a failed read is UNKNOWN in the reply, never 0 / [] / a 0% rate.
      const UNKNOWN = "unknown (read failed)";
      const revenueRead = readBridge(revenue);
      for (const row of scoreSnapshots ?? []) {
        try {
          const parsed = JSON.parse(row.content) as { score?: number };
          scores.push({
            date: row.updatedAt.toISOString().slice(0, 10),
            overallScore: typeof parsed.score === "number" ? parsed.score : null,
          });
        } catch (err) {
          // Skip malformed snapshot rows
          logError("ai.tools-habits", new Error(`Malformed snapshot row skipped in weeklyReview`), { date: row.updatedAt });
        }
      }

      const habits: Record<string, number> = {};
      for (const t of dailyHabits ?? []) habits[t.title] = t.streakCount;

      return {
        revenue: revenueRead.status === "ok" ? revenueRead.data : revenueRead,
        scores: scoreSnapshots ? scores.map((s) => ({ date: s.date, score: s.overallScore })) : UNKNOWN,
        avgScore: scores.length > 0
          ? Math.round(scores.reduce((s, d) => s + (d.overallScore ?? 0), 0) / scores.length * 10) / 10
          : null,
        tasks: {
          completed: tasksCompleted ?? UNKNOWN,
          created: tasksCreated ?? UNKNOWN,
          completionRate:
            tasksCompleted === null || tasksCreated === null ? null : tasksCreated > 0 ? Math.round((tasksCompleted / tasksCreated) * 100) : 0,
        },
        habits: dailyHabits ? habits : UNKNOWN,
        driftAlerts: alerts
          ? {
              total: alerts.length,
              resolved: alerts.filter((a) => {
                const meta = (a.metadata ?? {}) as Record<string, unknown>;
                return !!meta.ackedAt;
              }).length,
            }
          : UNKNOWN,
      };
    },
  }),

};
