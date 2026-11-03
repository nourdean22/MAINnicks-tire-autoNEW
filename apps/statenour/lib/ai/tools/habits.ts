/**
 * Habit + weekly-analysis tools.
 *
 * Includes: getHabitStreaks · weeklyReview.
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
  // 2026-11-03 · the journal was read-only from chat (getRecentReflections,
  // searchReflections) while the /journal capture modal wrote through
  // ingestJournal. Nour dictates entries from his phone mid-shift; this is
  // the same write the modal makes, source "chat".
  logJournalEntry: tool({
    description:
      "Write a journal entry in Nour's own words (the same path as the /journal capture). Pass his text verbatim, never a paraphrase. The entry is classified, linked to people it names, and may spawn tasks or insights; the result says what it did. Does NOT check off the journal habit; use completeTask for that. Example: {\"text\":\"Long day. Manny covered the counter while I did the Honda...\",\"kind\":\"reflection\"}",
    inputSchema: z.object({
      text: z.string().min(3).max(20_000).describe("The entry, verbatim"),
      kind: z
        .enum(["raw", "thinking", "reasoning", "insight", "decision", "reflection", "planning", "venting"])
        .optional()
        .describe("What kind of entry Nour said it is. Omit to let the classifier decide."),
    }),
    execute: async ({ text, kind }) => {
      const { ingestJournal } = await import("@/lib/brain/journal-ingest");
      try {
        const r = await ingestJournal(text.trim(), "chat", { entryTypeHint: kind });
        // An empty summary is the ingest's parse-failure shape (the entry is
        // saved, nothing was extracted); an absent peopleLinked means the
        // people link did not run. Neither is "0".
        const processed = r.summary !== "";
        return {
          logged: true,
          processed,
          entryId: r.brainDumpId,
          entryType: r.entryType,
          ...(processed
            ? { tasksCreated: r.tasksCreated, insightsStored: r.insightsStored, commitmentsFound: r.commitmentsFound, summary: r.summary }
            : { note: "saved, but the extraction failed (recorded); no tasks, insights or commitments were read from it" }),
          peopleLinked: r.peopleLinked ? r.peopleLinked.linked : "unknown (people link did not run)",
        };
      } catch (err) {
        logError("ai.tools-habits", err, { fn: "logJournalEntry" });
        return { logged: false, error: err instanceof Error ? err.message : "journal write failed" };
      }
    },
  }),

  getHabitStreaks: tool({
    description:
      "Habit check-offs for the last 7 ET days, per DAILY habit (workouts, journal, etc): which days are done (a day backfilled with completeTask.completedOn counts on its own day, an unchecked one does not), how many of 7, and the current streak. A read that failed says unknown.",
    inputSchema: z.object({}),
    execute: async () => {
      // 2026-11-03 · read the per-day TaskEvent ledger (habitDays) instead of
      // counting streakCount back from lastCompletedAt, which hid every day
      // backfilled before the latest check-off. A failed read is unknown, never
      // "no habits" or a week of not-done.
      let dailyTasks: Array<{ id: string; title: string; loopKind: string | null; streakCount: number; lastCompletedAt: Date | null }>;
      try {
        dailyTasks = await prisma.task.findMany({
          where: { loopKind: "DAILY", deletedAt: null },
          select: { id: true, title: true, loopKind: true, streakCount: true, lastCompletedAt: true },
        });
      } catch (err) {
        logError("ai.tools-habits", err, { fn: "getHabitStreaks" });
        return { error: "habits unknown (read failed)" };
      }
      const { habitDays } = await import("@/lib/services/daily-backfill");
      const grid = await habitDays(dailyTasks, 7).catch((err: unknown) => {
        logError("ai.tools-habits", err, { fn: "getHabitStreaks", scope: "ledger" });
        return null;
      });
      const summary: Record<string, unknown> = {};
      for (const t of dailyTasks) {
        const days = grid?.get(t.id);
        summary[t.title] = days
          ? { completed: days.filter((d) => d.done).length, total: days.length, streak: t.streakCount, last7: days }
          : { streak: t.streakCount, last7: "unknown (history read failed)" };
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
