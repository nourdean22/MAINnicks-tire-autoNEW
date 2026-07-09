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
      const sevenAgo = toDateString(daysAgo(7));

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
          .catch((err): Array<{ content: string; updatedAt: Date }> => {
            logError("ai.tools-habits", err, { fn: "weeklyReview", scope: "snapshots" });
            return [];
          }),
        prisma.task.count({ where: { status: "DONE", updatedAt: { gte: daysAgo(7) } } }).catch((err) => {
          logError("ai.tools-habits", err, { fn: "weeklyReview", scope: "tasksCompleted" });
          return 0;
        }),
        prisma.task.count({ where: { createdAt: { gte: daysAgo(7) } } }).catch((err) => {
          logError("ai.tools-habits", err, { fn: "weeklyReview", scope: "tasksCreated" });
          return 0;
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
          .catch((err): Array<{ title: string; streakCount: number }> => {
            logError("ai.tools-habits", err, { fn: "weeklyReview", scope: "dailyHabits" });
            return [];
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
          .catch((err) => {
            logError("ai.tools-habits", err, { fn: "weeklyReview", scope: "alerts" });
            return [];
          }),
      ]);

      // Parse score snapshots
      const scores: Array<{ date: string; overallScore: number | null }> = [];
      for (const row of scoreSnapshots) {
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
      for (const t of dailyHabits) habits[t.title] = t.streakCount;

      return {
        revenue,
        scores: scores.map((s) => ({ date: s.date, score: s.overallScore })),
        avgScore: scores.length > 0
          ? Math.round(scores.reduce((s, d) => s + (d.overallScore ?? 0), 0) / scores.length * 10) / 10
          : null,
        tasks: { completed: tasksCompleted, created: tasksCreated, completionRate: tasksCreated > 0 ? Math.round((tasksCompleted / tasksCreated) * 100) : 0 },
        habits,
        driftAlerts: {
          total: alerts.length,
          resolved: alerts.filter((a) => {
            const meta = (a.metadata ?? {}) as Record<string, unknown>;
            return !!meta.ackedAt;
          }).length,
        },
      };
    },
  }),

  analyzeWeek: tool({
    description: "Analyze the past 7 days — identity-snapshot history, tasks completed, drift patterns, daily-loop habit streaks",
    inputSchema: z.object({}),
    execute: async () => {
      // v10.0.54 · Wave A · Replaces retired DailyScore + HabitLog reads.
      // - "scores" → BrainMemory category="identity_snapshot" history
      //   (one row per day, content includes the rolled snapshot).
      // - "habits" → DAILY-loop Tasks completed in last 7d (one entry
      //   per completion via lastCompletedAt).
      const sevenDaysAgoDate = daysAgo(7);
      const sevenDaysAgoStr = toDateString(sevenDaysAgoDate);

      const [snapshotHistory, tasksDone, alerts, dailyTasks] = await Promise.all([
        prisma.brainMemory
          .findMany({
            where: {
              category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT,
              deletedAt: null,
              updatedAt: { gte: sevenDaysAgoDate },
            },
            orderBy: { updatedAt: "desc" },
            select: { content: true, updatedAt: true },
          })
          .catch((err): Array<{ content: string; updatedAt: Date }> => {
            logError("ai.tools-habits", err, { fn: "analyzeWeek", scope: "snapshotHistory" });
            return [];
          }),
        prisma.task.count({ where: { status: "DONE", lastTouchedAt: { gte: sevenDaysAgoDate } } }),
        prisma.brainMemory.count({
          where: {
            category: "coach_event",
            key: { startsWith: "coach:drift-recovery:" },
            createdAt: { gte: sevenDaysAgoDate },
            deletedAt: null,
          },
        }).catch((err) => {
          logError("ai.tools-habits", err, { fn: "analyzeWeek", scope: "alerts" });
          return 0;
        }),
        prisma.task
          .findMany({
            where: {
              loopKind: "DAILY",
              deletedAt: null,
              lastCompletedAt: { gte: sevenDaysAgoDate },
            },
            select: { title: true, streakCount: true },
          })
          .catch((err): Array<{ title: string; streakCount: number }> => {
            logError("ai.tools-habits", err, { fn: "analyzeWeek", scope: "dailyTasks" });
            return [];
          }),
      ]);

      // Parse snapshot.score from each history row (content is JSON
      // with {score?, energy?, ...} shape per the identity engine).
      const scores: Array<{ overallScore: number; workoutDone: boolean; journalDone: boolean }> = [];
      for (const row of snapshotHistory) {
        try {
          const parsed = JSON.parse(row.content) as {
            score?: number;
            workoutDone?: boolean;
            journalDone?: boolean;
          };
          scores.push({
            overallScore: typeof parsed.score === "number" ? parsed.score : 0,
            workoutDone: !!parsed.workoutDone,
            journalDone: !!parsed.journalDone,
          });
        } catch (err) {
          // Snapshot row not in JSON shape — skip.
          logError("ai.tools-habits", new Error(`Malformed snapshot row skipped in analyzeWeek`), { date: row.updatedAt });
        }
      }

      const avgScore =
        scores.length > 0
          ? scores.reduce((s, d) => s + d.overallScore, 0) / scores.length
          : 0;
      const perfectDays = scores.filter((d) => d.overallScore >= 8).length;
      const workoutDays = scores.filter((d) => d.workoutDone).length;
      const journalDays = scores.filter((d) => d.journalDone).length;

      // Habit streak surface — daily tasks with non-zero streak
      const habitStreaks: Record<string, number> = {};
      for (const t of dailyTasks) habitStreaks[t.title] = t.streakCount;

      return {
        period: `${sevenDaysAgoStr} to ${today()}`,
        avgScore: avgScore.toFixed(1),
        perfectDays,
        workoutDays,
        journalDays,
        tasksCompleted: tasksDone,
        driftAlerts: alerts,
        habitStreaks,
        assessment:
          perfectDays >= 5
            ? "Strong week"
            : perfectDays >= 3
              ? "Decent but inconsistent"
              : "Below standard — focus on fundamentals",
      };
    },
  }),

};
