/**
 * Goal + OKR + weekly-target tools.
 *
 * Includes: archiveGoal · setOKRs · setWeeklyTargets · getWeeklyTargets.
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
        .catch((err) => {
          void import("@/lib/utils/error-log").then(({ logError }) => logError("ai.tools.goals", err, { fn: "archiveGoal.undoToken" }, "error"));
          return null;
        });
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
