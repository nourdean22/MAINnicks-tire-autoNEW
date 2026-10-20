/**
 * Mission + project-planning tools.
 *
 * Includes: getMissions · getMissionDetail · addTasksToProject ·
 * createMissionPlan.
 *
 * 2026-10-18 · the mission retro reader and the mission status writer were removed
 * (never called in chat or on the bridge); status changes happen in the /missions UI.
 *
 * v10.0.529.106 · Wave 82 · extracted from monolithic lib/ai/tools.ts.
 * Aggregate barrel: lib/ai/tools.ts re-exports nourTools composed from
 * all 7 domain files. Catalog source of truth: lib/ai/tools/catalog.ts.
 */

import { tool } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createTaskAndEnrich } from "@/lib/services/tasks";
import { isUserProject } from "@/lib/services/mission-helpers";
import { logError } from "@/lib/utils/error-log";
import {
  DurableMissionStepSchema,
  getLatestMissionExecution,
  queueDurableMissionExecution,
} from "@/lib/missions/durable-execution";

// The legends live in ONE module — six copies of the string is why the
// 2026-09-03 fix reached only one of six call sites. See task-field-legends.ts.
import {
  effortField,
  contextField,
  LOOP_KIND_LEGEND_WEEKLY,
} from "@/lib/ai/tools/task-field-legends";

/** WEEKLY is valid here but not in tasks.ts — the vocabularies really differ. */
const loopKindWeeklyField = z
  .enum(["ONCE", "DAILY", "PROMISE", "WEEKLY"])
  .default("ONCE")
  .describe(LOOP_KIND_LEGEND_WEEKLY);

export const missionsTools = {
  getMissions: tool({
    description: "Get active missions",
    inputSchema: z.object({}),
    execute: async () => {
      // v10.0.532 · use canonical isUserProject predicate and propagate errors on DB failure
      try {
        const missions = await prisma.mission.findMany({
          where: {
            status: "ACTIVE",
            deletedAt: null,
          },
          select: { id: true, title: true, domain: true, priority: true, status: true, systemKind: true },
          orderBy: { priority: "desc" },
        });
        return missions.filter((m) => m.systemKind !== "SYSTEM" && isUserProject(m));
      } catch (err) {
        logError("ai.tools.missions", err as Error, { fn: "getMissions" });
        throw new Error("Missions database is unavailable");
      }
    },
  }),

  getMissionDetail: tool({
    description:
      "Get ONE mission with its real progress: task counts by state, the next physical actions, deadline health, and its retro if it was archived. Use when Nour asks how a specific mission or project is going, or which one is stalled.",
    inputSchema: z.object({
      missionId: z.string().optional().describe("Mission id. Omit to match by title."),
      title: z.string().optional().describe("Partial title match when the id is unknown."),
    }),
    execute: async ({ missionId, title }) => {
      if (!missionId && !title) {
        return { status: "no_data_found", message: "Provide missionId or title." };
      }
      try {
        const mission = await prisma.mission.findFirst({
          where: {
            deletedAt: null,
            ...(missionId
              ? { id: missionId }
              : { title: { contains: title!, mode: "insensitive" as const } }),
          },
          select: {
            id: true,
            title: true,
            domain: true,
            status: true,
            priority: true,
            deadline: true,
            successMetric: true,
            weeklyReviewNote: true,
            systemKind: true,
          },
        });
        if (!mission) {
          return { status: "no_data_found", message: "No mission matched." };
        }

        const [counts, openTasks, latestExecution] = await Promise.all([
          prisma.task.groupBy({
            by: ["status"],
            where: { missionId: mission.id, deletedAt: null },
            _count: { _all: true },
          }),
          prisma.task.findMany({
            where: { missionId: mission.id, deletedAt: null, status: { not: "DONE" } },
            select: { title: true, nextPhysicalAction: true, dueDate: true },
            orderBy: { updatedAt: "desc" },
            take: 5,
          }),
          getLatestMissionExecution(mission.id),
        ]);

        let total = 0;
        let done = 0;
        for (const row of counts) {
          total += row._count._all;
          if (row.status === "DONE") done += row._count._all;
        }

        // Deadline health is stated, never inferred into a score: a
        // mission with no deadline is "none", not "on track".
        const deadlineState = !mission.deadline
          ? "none"
          : mission.deadline.getTime() < Date.now()
            ? "overdue"
            : "upcoming";

        return {
          id: mission.id,
          title: mission.title,
          domain: mission.domain,
          status: mission.status,
          priority: mission.priority,
          successMetric: mission.successMetric,
          weeklyReviewNote: mission.weeklyReviewNote,
          isUserProject: isUserProject(mission),
          progress: {
            total,
            done,
            open: total - done,
            // No percentage when there are no tasks — 0/0 is not 0%.
            percentComplete: total > 0 ? Math.round((done / total) * 100) : null,
          },
          deadline: mission.deadline?.toISOString() ?? null,
          deadlineState,
          durableExecution: latestExecution,
          nextActions: openTasks.map((t) => ({
            title: t.title,
            nextPhysicalAction: t.nextPhysicalAction,
            dueDate: t.dueDate?.toISOString() ?? null,
          })),
        };
      } catch (err) {
        logError("ai.tools.missions", err as Error, { fn: "getMissionDetail" });
        throw new Error("Missions database is unavailable");
      }
    },
  }),

  queueMissionExecution: tool({
    description:
      "Queue bounded durable background execution for an existing ACTIVE mission. V1 supports checkpoint and deep-research steps only; it survives chat closure/redeploys through Inngest, records progress to the Reality Ledger, and NEVER marks the mission complete automatically.",
    inputSchema: z.object({
      missionId: z.string(),
      objective: z.string().min(5).max(1000),
      steps: z.array(DurableMissionStepSchema).min(1).max(12),
    }),
    execute: async ({ missionId, objective, steps }) => {
      try {
        return await queueDurableMissionExecution({
          missionId,
          objective,
          steps,
          requestedBy: "nick",
        });
      } catch (err) {
        logError("ai.tools.missions", err as Error, { fn: "queueMissionExecution" });
        throw new Error("Durable mission execution could not be queued");
      }
    },
  }),

  addTasksToProject: tool({
    description: "Create multiple tasks under missions (projects) in bulk. Use when Nour needs to break down a project into several specific tasks at once, or lock in a daily/weekly routine with multiple schedule blocks.",
    inputSchema: z.object({
      missionId: z.string().optional().describe("Fallback mission ID if not specified per-task"),
      tasks: z.array(z.object({
        title: z.string(),
        missionId: z.string().optional().describe("Specific mission ID for this task. Use to route different tasks to different missions (e.g. Health, Business, Personal)"),
        nextPhysicalAction: z.string().describe("The literal first physical step"),
        effort: effortField(),
        context: contextField(),
        loopKind: loopKindWeeklyField,
        recurringDays: z.array(z.number().int().min(0).max(6)).optional().describe("For WEEKLY loopKind · 0=Sunday .. 6=Saturday"),
        dueDate: z.string().optional().describe("ISO date string"),
        goalId: z.string().optional().describe("Associated goal ID"),
        promiseTo: z.string().optional().describe("Promised to who (e.g. 'Dania', 'myself')"),
        personId: z.string().optional().describe("Associated person ID"),
      })).min(1),
    }),
    execute: async ({ missionId, tasks }) => {
      const createdTasks = [];
      for (const t of tasks) {
        const activeMissionId = t.missionId || missionId || "m-inbox";
        const task = await createTaskAndEnrich({
          title: t.title,
          missionId: activeMissionId,
          nextPhysicalAction: t.nextPhysicalAction,
          effort: t.effort,
          roiScore: t.loopKind === "PROMISE" ? 80 : 50,
          frictionScore: 30,
          energyRequired: "MEDIUM",
          context: t.context,
          finishCondition: t.title,
          loopKind: t.loopKind as any,
          recurringDays: t.recurringDays ?? [],
          dueDate: t.dueDate ? new Date(t.dueDate) : null,
          goalId: t.goalId ?? null,
          promiseTo: t.promiseTo ?? null,
          personId: t.personId ?? null,
        });
        createdTasks.push({ taskId: task.id, title: task.title, loopKind: task.loopKind, missionId: activeMissionId });
      }
      return { created: true, count: createdTasks.length, fallbackMissionId: missionId, tasks: createdTasks };
    },
  }),

  createMissionPlan: tool({
    description:
      "Create a mission with multiple linked tasks in one call. Use when Nour describes a multi-step project or goal. `tasks` must hold AT LEAST ONE task — an empty array is rejected and nothing is created, so if the steps are not known yet, create the tasks later with addTasksToProject rather than sending [].",
    inputSchema: z.object({
      title: z.string().describe("Mission title"),
      domain: z
        .enum(["BUSINESS", "PERSONAL", "HEALTH", "CONTENT", "FINANCE"])
        .describe("Which life area this mission belongs to. Exactly one of: BUSINESS · PERSONAL · HEALTH · CONTENT · FINANCE."),
      priority: z.number().min(1).max(100).default(50).describe("1-100, higher is more important."),
      successMetric: z.string().optional().describe("How to measure success"),
      tasks: z.array(z.object({
        title: z.string(),
        nextPhysicalAction: z.string().describe("The literal first physical step"),
        effort: effortField(),
        context: contextField(),
        loopKind: loopKindWeeklyField,
        recurringDays: z.array(z.number().int().min(0).max(6)).optional().describe("For WEEKLY loopKind · 0=Sunday .. 6=Saturday"),
        dueDate: z.string().optional().describe("ISO date string"),
        goalId: z.string().optional().describe("Associated goal ID"),
        promiseTo: z.string().optional().describe("Promised to who"),
        personId: z.string().optional().describe("Associated person ID"),
      })).min(1).max(20),
    }),
    execute: async ({ title, domain, priority, successMetric, tasks }) => {
      // Create mission first
      // The tool contract is 1-100 (model-friendly); Mission.priority is
      // 1-10 (validators + rankMissions clamp). Writing 1-100 raw saturated
      // the ranking term at 100 for every chat-created mission.
      const mission = await prisma.mission.create({
        data: {
          title,
          domain,
          priority: Math.max(1, Math.min(10, Math.round(priority / 10))),
          roiScore: priority,
          neglectCost: Math.round(priority * 0.7),
          successMetric,
          status: "ACTIVE",
        },
      });
      // Create tasks linked to mission
      const createdTasks = [];
      for (let i = 0; i < tasks.length; i++) {
        const t = tasks[i];
        const task = await createTaskAndEnrich({
          title: t.title,
          missionId: mission.id,
          nextPhysicalAction: t.nextPhysicalAction,
          effort: t.effort,
          context: t.context,
          finishCondition: t.title,
          roiScore: Math.max(10, 90 - i * 10),
          frictionScore: 30,
          energyRequired: "MEDIUM",
          loopKind: t.loopKind as any,
          recurringDays: t.recurringDays ?? [],
          dueDate: t.dueDate ? new Date(t.dueDate) : null,
          goalId: t.goalId ?? null,
          promiseTo: t.promiseTo ?? null,
          personId: t.personId ?? null,
        });
        createdTasks.push(task);
      }
      return {
        created: true,
        missionId: mission.id,
        title: mission.title,
        taskCount: createdTasks.length,
        tasks: createdTasks.map(t => ({ id: t.id, title: t.title, action: t.nextPhysicalAction })),
      };
    },
  }),

};
