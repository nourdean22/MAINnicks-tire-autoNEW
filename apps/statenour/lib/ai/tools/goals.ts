/**
 * Goal + OKR + weekly-target tools.
 *
 * Includes: getProjections · archiveGoal · logGoalProgress · setLifeGoal ·
 * setOKRs · setWeeklyTargets · getWeeklyTargets.
 *
 * v10.0.529.106 · Wave 82 · extracted from monolithic lib/ai/tools.ts.
 * Aggregate barrel: lib/ai/tools.ts re-exports nourTools composed from
 * all 7 domain files. Catalog source of truth: lib/ai/tools/catalog.ts.
 */

import { tool } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { computeIsoWeekKey } from "@/lib/ai/context/command-center-state";

export const goalsTools = {
  getProjections: tool({
    description: "Get current life-goal progress + business revenue projection. Goals come from the LifeGoal table; revenue projection comes from the nickstire bridge (revenue-trend extrapolation when available).",
    inputSchema: z.object({ domain: z.string().optional().describe("Filter by domain: business, energy, habits, finance") }),
    execute: async ({ domain }) => {
      // v10.0.54 · Wave A · Replaces dead `Promise.resolve([])` for the
      // Projection table (retired Apr 19). LifeGoal.progress is now the
      // primary projection signal. Optionally augments with a revenue
      // projection from nickstire (revenue_range over 30d → annualize).
      const goals = await prisma.lifeGoal.findMany({
        where: {
          deletedAt: null,
          status: "active",
          ...(domain ? { domain } : {}),
        },
      }).catch((): never[] => []);

      // Best-effort revenue projection from bridge. Bridge failure
      // returns null → projections array empty, goals still surface.
      let revenueProjection: { current: number; projectedAnnual: number } | null = null;
      if (!domain || domain === "business" || domain === "finance") {
        try {
          const { queryNick } = await import("@/lib/nickstire/query");
          // revenue_range filters on { from, to } date strings (ET), NOT
          // `since` — sending `since` was silently ignored, so from/to both
          // defaulted to today and the "30-day × 12" projection was really a
          // 1-day window × 12 (wildly understated). Send the real 30-day span.
          const fromIso = new Date(Date.now() - 30 * 86400000)
            .toISOString()
            .slice(0, 10);
          const toIso = new Date().toISOString().slice(0, 10);
          const res = await queryNick<{ totalDollars?: number }>(
            "revenue_range",
            { from: fromIso, to: toIso },
          );
          if ("data" in res && typeof res.data?.totalDollars === "number") {
            const monthly = res.data.totalDollars;
            revenueProjection = { current: monthly, projectedAnnual: Math.round(monthly * 12) };
          }
        } catch {
          // Bridge unavailable — projections degrade to goals-only.
        }
      }

      return {
        projections: revenueProjection
          ? [
              {
                domain: "business",
                metric: "revenue_30d",
                current: revenueProjection.current,
                projected: revenueProjection.projectedAnnual,
                target: null,
                trend: null,
                insight: "30-day revenue × 12 (linear projection)",
              },
            ]
          : [],
        goals: goals.map((g) => ({
          title: g.title,
          progress: g.progress,
          target: g.targetValue,
          unit: g.unit,
        })),
      };
    },
  }),

  archiveGoal: tool({
    description:
      "Archive a LifeGoal (soft-delete · preserves CoachLog + GoalEvent history · recoverable). Use when Nour says 'drop this goal' / 'archive that goal'. Pre-Wave-28 the UI hard-deleted goals · now both UI + Nick use soft-delete.",
    inputSchema: z.object({
      goalId: z.string().optional(),
      titleQuery: z
        .string()
        .optional()
        .describe("Fuzzy match against active goal titles if goalId unknown."),
    }),
    execute: async ({ goalId, titleQuery }) => {
      let target = goalId
        ? await prisma.lifeGoal.findUnique({
            where: { id: goalId },
            select: { id: true, title: true, status: true },
          })
        : null;
      if (!target && titleQuery) {
        const candidates = await prisma.lifeGoal.findMany({
          where: {
            status: "active",
            title: { contains: titleQuery, mode: "insensitive" },
            deletedAt: null,
          },
          orderBy: { updatedAt: "desc" },
          take: 1,
          select: { id: true, title: true, status: true },
        });
        target = candidates[0] ?? null;
      }
      if (!target) {
        return { success: false, reason: "goal not found" };
      }
      // v10.0.529.97 · Wave 41 · snapshot pre-state for undo. archiveGoal
      // is the second-highest "wrong target" risk · fuzzy titleQuery on
      // a partial goal name can pick the wrong row.
      const originalStatus = target.status;
      await prisma.lifeGoal.update({
        where: { id: target.id },
        data: { status: "paused", deletedAt: new Date() },
      });
      const undoToken = `undo_${target.id}_${Date.now()}`;
      const undoExpiresAt = new Date(Date.now() + 30 * 1000);
      await prisma.brainMemory
        .create({
          data: {
            category: "undo_token",
            key: undoToken,
            content: JSON.stringify({
              toolName: "archiveGoal",
              goalId: target.id,
              originalStatus,
            }),
            source: "chat-tool",
            confidence: 1.0,
            expiresAt: undoExpiresAt,
            createdBy: "nick",
          },
        })
        .catch(() => null);
      return {
        success: true,
        goalId: target.id,
        title: target.title,
        archived: true,
        undoToken,
        undoExpiresAt: undoExpiresAt.toISOString(),
      };
    },
  }),

  logGoalProgress: tool({
    description:
      "Log progress on a LifeGoal · bumps currentValue + recalculates progress % + appends a GoalEvent(kind=progress_logged). Auto-flips to 'achieved' when currentValue reaches targetValue. Use when Nour says 'logged 200lb bench' or 'hit $500 in sales today'.",
    inputSchema: z.object({
      goalId: z.string().optional(),
      titleQuery: z.string().optional(),
      delta: z
        .number()
        .describe("How much to ADD to currentValue · positive · the increment, not the absolute total"),
      note: z.string().optional().describe("Short note on this progress · stored in GoalEvent.payload"),
    }),
    execute: async ({ goalId, titleQuery, delta, note }) => {
      let target = goalId
        ? await prisma.lifeGoal.findUnique({
            where: { id: goalId },
            select: { id: true, title: true, currentValue: true, targetValue: true, status: true },
          })
        : null;
      if (!target && titleQuery) {
        const candidates = await prisma.lifeGoal.findMany({
          where: {
            status: "active",
            title: { contains: titleQuery, mode: "insensitive" },
            deletedAt: null,
          },
          orderBy: { updatedAt: "desc" },
          take: 1,
          select: { id: true, title: true, currentValue: true, targetValue: true, status: true },
        });
        target = candidates[0] ?? null;
      }
      if (!target) return { success: false, reason: "goal not found" };

      const nextValue = Math.min(target.targetValue, target.currentValue + delta);
      const progress = Math.min(100, Math.round((nextValue / target.targetValue) * 100));
      const reachedTarget = nextValue >= target.targetValue;
      const updateData: Record<string, unknown> = {
        currentValue: nextValue,
        progress,
        updatedAt: new Date(),
      };
      if (reachedTarget && target.status !== "achieved") {
        updateData.status = "achieved";
        updateData.achievedAt = new Date();
      }
      await prisma.lifeGoal.update({ where: { id: target.id }, data: updateData });
      await prisma.goalEvent.create({
        data: {
          goalId: target.id,
          kind: reachedTarget ? "achieved" : "progress_logged",
          payload: { delta, note: note ?? null, after: nextValue },
          source: "nick-tool:logGoalProgress",
        },
      });
      return {
        success: true,
        goalId: target.id,
        title: target.title,
        previousValue: target.currentValue,
        currentValue: nextValue,
        progress,
        achieved: reachedTarget,
      };
    },
  }),

  setLifeGoal: tool({
    description: "Set a life or business goal for Nour to track. Examples: revenue target, weight goal, savings goal, habit streak goal.",
    inputSchema: z.object({
      domain: z.enum(["business", "fitness", "finance", "personal", "career"]),
      title: z.string().describe("Human-readable goal title"),
      metric: z.string().describe("The metric to track: revenue, weight, savings, streak"),
      targetValue: z.number(),
      unit: z.string().default(""),
      deadline: z.string().optional().describe("ISO date string for deadline"),
    }),
    execute: async ({ domain, title, metric, targetValue, unit, deadline }) => {
      const goal = await prisma.lifeGoal.create({
        data: { domain, title, metric, targetValue, unit, deadline: deadline ? new Date(deadline) : null },
      });
      return { created: true, goalId: goal.id, title };
    },
  }),

  setOKRs: tool({
    description: "Set quarterly OKRs (Objectives and Key Results). Use when planning the quarter or when Nour asks about goals/OKRs.",
    inputSchema: z.object({
      quarter: z.string().describe("e.g., Q2 2026"),
      objectives: z.array(z.object({
        title: z.string(),
        keyResults: z.array(z.object({
          metric: z.string(),
          target: z.number(),
          current: z.number().default(0),
          unit: z.string().default(""),
        })),
      })).describe("1-3 objectives with 2-4 key results each"),
    }),
    execute: async ({ quarter, objectives }) => {
      // Store as commitment records with OKR data in notes
      const results = [];
      for (const obj of objectives) {
        const commitment = await prisma.commitment.create({
          data: {
            dateMade: new Date().toISOString().split("T")[0],
            description: `[OKR ${quarter}] ${obj.title}`,
            domain: "strategy",
            status: "active",
            notes: JSON.stringify({ type: "okr", quarter, keyResults: obj.keyResults }),
          },
        });
        results.push({ id: commitment.id, objective: obj.title, keyResults: obj.keyResults.length });
      }
      return {
        quarter,
        created: results,
        message: `${results.length} OKR objectives set for ${quarter}. Track progress with checkCommitments.`,
      };
    },
  }),

  setWeeklyTargets: tool({
    description: "Set this week's 3 targets. Call on Monday or when Nour wants to set goals. Stores them so you can reference mid-week.",
    inputSchema: z.object({
      revenue: z.string().describe("Revenue/business target for the week"),
      personal: z.string().describe("Personal/growth target for the week"),
      health: z.string().describe("Health/body target for the week"),
    }),
    execute: async ({ revenue, personal, health }) => {
      const weekKey = computeIsoWeekKey(new Date());

      const targets = { revenue, personal, health, setAt: new Date().toISOString() };

      await prisma.brainMemory.upsert({
        where: { category_key: { category: BRAIN_CATEGORIES.WEEKLY_TARGET, key: `week_${weekKey}` } },
        create: {
          category: BRAIN_CATEGORIES.WEEKLY_TARGET,
          key: `week_${weekKey}`,
          content: `Week of ${weekKey}: REVENUE: ${revenue} | PERSONAL: ${personal} | HEALTH: ${health}`,
          confidence: 1.0,
          source: "weekly_targets",
          metadata: targets,
        },
        update: {
          content: `Week of ${weekKey}: REVENUE: ${revenue} | PERSONAL: ${personal} | HEALTH: ${health}`,
          metadata: targets,
        },
      });

      return { stored: true, weekOf: weekKey, targets };
    },
  }),

  getWeeklyTargets: tool({
    description: "Get this week's 3 targets to check progress. Use mid-week to reference what was set on Monday.",
    inputSchema: z.object({}),
    execute: async () => {
      const weekKey = computeIsoWeekKey(new Date());

      const target = await prisma.brainMemory.findUnique({
        where: { category_key: { category: BRAIN_CATEGORIES.WEEKLY_TARGET, key: `week_${weekKey}` } },
      });

      if (!target) return { hasTargets: false, message: "No targets set for this week. It's time to set them." };

      return {
        hasTargets: true,
        weekOf: weekKey,
        targets: target.metadata,
        raw: target.content,
      };
    },
  }),

};
