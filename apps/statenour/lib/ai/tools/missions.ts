/**
 * Mission + project-planning tools.
 *
 * Includes: getMissions · addTasksToProject · createMissionPlan.
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

  addTasksToProject: tool({
    description: "Create multiple tasks under missions (projects) in bulk. Use when Nour needs to break down a project into several specific tasks at once, or lock in a daily/weekly routine with multiple schedule blocks.",
    inputSchema: z.object({
      missionId: z.string().optional().describe("Fallback mission ID if not specified per-task"),
      tasks: z.array(z.object({
        title: z.string(),
        missionId: z.string().optional().describe("Specific mission ID for this task. Use to route different tasks to different missions (e.g. Health, Business, Personal)"),
        nextPhysicalAction: z.string().describe("The literal first physical step"),
        effort: z.enum(["M5", "M15", "M30", "H1", "H2PLUS"]).default("M30"),
        context: z.enum(["DESK", "PHONE", "SHOP", "CAR", "HOME", "ANYWHERE"]).default("ANYWHERE"),
        loopKind: z.enum(["ONCE", "DAILY", "PROMISE", "WEEKLY"]).default("ONCE"),
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
    description: "Create a mission with multiple linked tasks in one call. Use when Nour describes a multi-step project or goal.",
    inputSchema: z.object({
      title: z.string().describe("Mission title"),
      domain: z.enum(["BUSINESS", "PERSONAL", "HEALTH", "CONTENT", "FINANCE"]),
      priority: z.number().min(1).max(100).default(50),
      successMetric: z.string().optional().describe("How to measure success"),
      tasks: z.array(z.object({
        title: z.string(),
        nextPhysicalAction: z.string().describe("The literal first physical step"),
        effort: z.enum(["M5", "M15", "M30", "H1", "H2PLUS"]).default("M30"),
        context: z.enum(["DESK", "PHONE", "SHOP", "CAR", "HOME", "ANYWHERE"]).default("ANYWHERE"),
        loopKind: z.enum(["ONCE", "DAILY", "PROMISE", "WEEKLY"]).default("ONCE"),
        recurringDays: z.array(z.number().int().min(0).max(6)).optional().describe("For WEEKLY loopKind · 0=Sunday .. 6=Saturday"),
        dueDate: z.string().optional().describe("ISO date string"),
        goalId: z.string().optional().describe("Associated goal ID"),
        promiseTo: z.string().optional().describe("Promised to who"),
        personId: z.string().optional().describe("Associated person ID"),
      })).min(1).max(20),
    }),
    execute: async ({ title, domain, priority, successMetric, tasks }) => {
      // Create mission first
      const mission = await prisma.mission.create({
        data: {
          title,
          domain,
          priority,
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
