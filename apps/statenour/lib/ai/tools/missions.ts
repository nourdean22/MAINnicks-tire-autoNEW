/**
 * Mission + project-planning tools.
 *
 * Includes: getMissions · getMissionDetail · getMissionRetros ·
 * addTasksToProject · createMissionPlan · updateMissionStatus.
 *
 * WP-3 (2026-07-29) — thin-module coverage. The blueprint named missions
 * as one of the two surfaces the operator touches daily with the least
 * Nick coverage; verified before building: exactly 3 tools existed, and
 * the gaps were concrete rather than theoretical —
 *   · getMissions returns ACTIVE rows with bare fields, so Nick could
 *     not answer "how is X going?" or "which mission is stalled?"
 *   · no status mutation at all (the enum has PAUSED/COMPLETE/KILLED),
 *     so Nick could plan a mission but never close one out
 *   · retros are written to BrainMemory(mission_retro) and feed the
 *     morning brief, but nothing could READ them back in chat
 * The three additions below close exactly those, and nothing more.
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

        const [counts, openTasks] = await Promise.all([
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

  getMissionRetros: tool({
    description:
      "Read recent mission retrospectives (what was learned when a mission was closed out). Use when Nour asks what he learned from finished missions or wants past lessons before starting something similar.",
    inputSchema: z.object({
      limit: z.number().int().min(1).max(10).default(5),
    }),
    execute: async ({ limit }) => {
      try {
        const rows = await prisma.brainMemory.findMany({
          where: { category: "mission_retro", deletedAt: null },
          orderBy: { createdAt: "desc" },
          take: limit,
          select: { content: true, createdAt: true, metadata: true },
        });
        return rows.map((r) => {
          const m = (r.metadata ?? {}) as {
            missionTitle?: string;
            taskCount?: number;
            openCount?: number;
          };
          return {
            missionTitle: m.missionTitle ?? null,
            retro: r.content,
            closedAt: r.createdAt.toISOString(),
            tasksAtClose: m.taskCount ?? null,
            openAtClose: m.openCount ?? null,
          };
        });
      } catch (err) {
        logError("ai.tools.missions", err as Error, { fn: "getMissionRetros" });
        throw new Error("Missions database is unavailable");
      }
    },
  }),

  updateMissionStatus: tool({
    description:
      "Change a mission's lifecycle status (PAUSED / COMPLETE / KILLED / ACTIVE). Use when Nour says a project is done, on hold, or dead. Does NOT write a retrospective — closing out with lessons is a separate deliberate step.",
    inputSchema: z.object({
      missionId: z.string(),
      status: z.enum(["ACTIVE", "PAUSED", "COMPLETE", "KILLED"]),
      note: z
        .string()
        .max(500)
        .optional()
        .describe("Short why — stored on the mission's weekly review note."),
    }),
    execute: async ({ missionId, status, note }) => {
      try {
        const existing = await prisma.mission.findFirst({
          where: { id: missionId, deletedAt: null },
          select: { id: true, title: true, status: true },
        });
        if (!existing) {
          return { status: "no_data_found", message: "No mission with that id." };
        }
        if (existing.status === status) {
          // Idempotent: report the no-op honestly rather than claiming a change.
          return {
            ok: true,
            changed: false,
            missionId,
            title: existing.title,
            status,
            message: `Already ${status} — nothing changed.`,
          };
        }
        const updated = await prisma.mission.update({
          where: { id: missionId },
          data: {
            status,
            updatedBy: "nick",
            ...(note ? { weeklyReviewNote: note } : {}),
          },
          select: { id: true, title: true, status: true },
        });
        // Audit row: a lifecycle change the operator can trace back.
        await prisma.auditEvent
          .create({
            data: {
              actor: "nick",
              eventType: "mission_status_changed",
              detail: `${updated.title}: ${existing.status} → ${status}`,
              payload: { missionId, from: existing.status, to: status, note: note ?? null },
            },
          })
          .catch((e: unknown) =>
            logError("ai.tools.missions", e as Error, { fn: "updateMissionStatus.audit" }, "warn"),
          );
        return {
          ok: true,
          changed: true,
          missionId: updated.id,
          title: updated.title,
          previousStatus: existing.status,
          status: updated.status,
        };
      } catch (err) {
        logError("ai.tools.missions", err as Error, { fn: "updateMissionStatus" });
        throw new Error("Mission status update failed");
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
