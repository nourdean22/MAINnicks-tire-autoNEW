/**
 * Goal + OKR + weekly-target tools.
 *
 * Includes: getGoals · getRelated · logGoalCheckIn · archiveGoal · setOKRs ·
 * setWeeklyTargets · getWeeklyTargets.
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
import { CHECK_IN_HEALTH } from "@/lib/brain/goal-pace";
import { RELATED_DEFAULT_DAYS, RELATED_MAX_DAYS } from "@/lib/services/related-activity";


export const goalsTools = {

  // Job 2026-11-02-nour-os-interconnect W1 · Nick sees goals BY ID (createTask.goalId,
  // logGoalCheckIn and getRelated take one). Health is the newest check-in; none is a visible
  // state (Linear L2), and a failed read is "unknown", never "no check-in".
  getGoals: tool({
    description:
      "List Nour's active goals with their ids: title, kind, horizon, unit, current/target value, due date, pace, health (from the latest check-in, or no_check_in) and open linked tasks. Use the id with createTask.goalId, createMissionPlan.lifeGoalId, getRelated and logGoalCheckIn.",
    inputSchema: z.object({}),
    // W6: the read lives in lib/services/goal-health.ts (recall reads the same shape); health is goalHealthFrom
    // with the horizon's cadence, as on the goal card.
    execute: async () => {
      const { activeGoalsWithHealth } = await import("@/lib/services/goal-health");
      const r = await activeGoalsWithHealth();
      return { goals: r.goals.map(({ status: _s, paceKind: _p, ...g }) => g), failed: r.failed };
    },
  }),

  // The relatedActivity spine, pulled on demand (never pushed into every prompt).
  getRelated: tool({
    description:
      "Everything logged about ONE goal, mission or person in the last N days: goal check-ins and progress, task changes (a goal also reaches tasks through its missions), journal entries, reflections, situations, decisions, contacts and chats, newest first. Pass goalId (from getGoals), missionId (from getMissions) or personId. `failed` names any source that could not be read: its rows are missing, not zero.",
    inputSchema: z.object({
      goalId: z.string().optional(),
      missionId: z.string().optional(),
      personId: z.string().optional(),
      days: z.number().int().min(1).max(RELATED_MAX_DAYS).optional().describe(`Look-back window, default ${RELATED_DEFAULT_DAYS}`),
    }),
    execute: async ({ goalId, missionId, personId, days }) => {
      if (!goalId && !missionId && !personId) return { error: "pass a goalId, missionId or personId" };
      const { relatedActivity } = await import("@/lib/services/related-activity");
      const since = new Date(Date.now() - (days ?? RELATED_DEFAULT_DAYS) * 86_400_000);
      const r = await relatedActivity({ goalId, missionId, personId }, { since });
      return {
        items: r.items.map((i) => ({ title: i.title, kind: i.kind, source: i.source, at: i.at.toISOString() })),
        failed: r.failed,
      };
    },
  }),

  // One check-in per goal per ET day: the GoalEvent's idempotency key is the claim (create, P2002
  // reads the winner; claim-before-act rule 4). The goal is matched by id ONLY; the note is never
  // parsed for a target. currentValue is SET (not incremented), and only on a metric goal.
  logGoalCheckIn: tool({
    description:
      "Log a goal check-in: health (on_track, at_risk, off_track) and a short note, plus the current value for a metric goal. One per goal per day. goalId must come from getGoals.",
    inputSchema: z.object({
      goalId: z.string().min(1).describe("The goal's id from getGoals"),
      health: z.enum(CHECK_IN_HEALTH),
      value: z.number().optional().describe("Metric goals only: the value now (sets currentValue, does not add)"),
      note: z.string().max(500).describe("One line on why"),
    }),
    // The writer lives in lib/services/goal-checkin.ts (W2): the goal card saves through the same one.
    execute: async ({ goalId, health, value, note }) => {
      const { logGoalCheckIn } = await import("@/lib/services/goal-checkin");
      return logGoalCheckIn({ goalId, health, value, note, source: "chat" });
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
