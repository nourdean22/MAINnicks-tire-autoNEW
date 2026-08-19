/**
 * Task + planning tools — personal_read / personal_write / planning / routines.
 *
 * Includes: getTasks · createTask · completeTask · getMissions ·
 * createMissionPlan · setMit · setOKRs · setWeeklyTargets · dailyPulse ·
 * endOfDay · weeklyReview · calendar · commitments · goals.
 *
 * v10.0.529.106 · Wave 82 · extracted from monolithic lib/ai/tools.ts.
 * Aggregate barrel: lib/ai/tools.ts re-exports nourTools composed from
 * all 7 domain files. Catalog source of truth: lib/ai/tools/catalog.ts.
 *
 * Wave 83 · this file was further decomposed into per-domain sub-files
 * under lib/ai/tools/ (goals · missions · habits · health · finance ·
 * calendar). The tasks-core tools stay here as tasksCoreTools; the
 * public `tasksTools` export below recomposes all 46 keys verbatim so
 * the barrel + every consumer continue to work unchanged.
 */

import { tool } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createTaskAndEnrich, liftGoalOnTaskComplete } from "@/lib/services/tasks";
import { creditTaskStats } from "@/lib/mastery/goal-stats";
import { recordError } from "@/lib/errors/record-error";
import { today, daysAgo, toDateString } from "@/lib/utils/datetime";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { goalsTools } from "@/lib/ai/tools/goals";
import { missionsTools } from "@/lib/ai/tools/missions";
import { habitsTools } from "@/lib/ai/tools/habits";
import { healthTools } from "@/lib/ai/tools/health";
import { financeTools } from "@/lib/ai/tools/finance";
import { calendarTools } from "@/lib/ai/tools/calendar";
import { getUnresolvedAlerts } from "@/lib/mastery/drift-engine";

const tasksCoreTools = {
  getMasteryScores: tool({
    description: "Get current mastery domain scores",
    inputSchema: z.object({}),
    execute: async () => {
      // v10.0.529.94 · Wave 38 · field projection. Pre-Wave-38 this
      // returned full Prisma rows (id · createdAt · updatedAt · userId)
      // that the model never references · payload ~3-4x larger than
      // needed. Drop to the 4 fields Nick actually reasons over.
      const scores = await prisma.masteryScore.findMany({
        orderBy: [{ date: "desc" }],
        take: 12,
        select: { domain: true, score: true, delta: true, date: true },
      });
      return scores;
    },
  }),

  getDriftAlerts: tool({
    description: "Get unresolved drift alerts",
    inputSchema: z.object({}),
    execute: async () => {
      return getUnresolvedAlerts().catch((err): never[] => {
        void import("@/lib/utils/error-log").then(({ logError }) => logError("ai.tools.tasks", err, { fn: "getDriftAlerts" }, "error"));
        return [];
      });
    },
  }),

  getCommitments: tool({
    description: "Get active commitments",
    inputSchema: z.object({}),
    execute: async () => {
      return prisma.commitment.findMany({ where: { status: { in: ["active", "in_progress"] }, deletedAt: null } }).catch((err): never[] => {
        void import("@/lib/utils/error-log").then(({ logError }) => logError("ai.tools.tasks", err, { fn: "getCommitments" }, "error"));
        return [];
      });
    },
  }),

  // 2026-08-12 · retrieval-side JIT complement. The prompt gate drops
  // the inline ACTIVE AGENDA section on casual/social-content turns;
  // this tool is the way back to that data when such a turn needs it
  // (distinct from getCommitments — agendaItem rows carry witnessed
  // commitments, standing intentions, contradictions, neglect alerts).
  getAgendaItems: tool({
    description:
      "Get the operator's active agenda items — witnessed commitments, standing intentions, contradictions, and neglect alerts. Call this when the inline agenda section was omitted for this turn but the operator's agenda matters to the answer.",
    inputSchema: z.object({}),
    execute: async () => {
      return prisma.agendaItem
        .findMany({
          where: { status: { in: ["ACTIVE", "SNOOZED"] } },
          orderBy: { createdAt: "desc" },
          select: { category: true, title: true, description: true, dueDate: true, status: true },
        })
        .catch((err): never[] => {
          void import("@/lib/utils/error-log").then(({ logError }) => logError("ai.tools.tasks", err, { fn: "getAgendaItems" }, "error"));
          return [];
        });
    },
  }),

  // getOpenLoops retired Apr 18 — use getTasks (already filters
  // INBOX/READY/DOING, includes mission context).

  getTasks: tool({
    description: "Get active tasks with their missions",
    inputSchema: z.object({}),
    execute: async () => {
      // v10.0.529.94 · Wave 38 · field projection · keep id (tool-call
      // anchor) · title · status · autoPriority · effort · context ·
      // loopKind · dueDate · streakCount + mission.title/domain. Drop
      // createdAt / updatedAt / userId / nextPhysicalAction lineage etc.
      return prisma.task.findMany({
        where: { status: { in: ["INBOX", "READY", "DOING"] }, deletedAt: null },
        select: {
          id: true,
          title: true,
          status: true,
          autoPriority: true,
          effort: true,
          context: true,
          loopKind: true,
          dueDate: true,
          streakCount: true,
          mission: { select: { title: true, domain: true } },
        },
        orderBy: { autoPriority: { sort: "desc", nulls: "last" } },
      }).catch((err): never[] => {
        void import("@/lib/utils/error-log").then(({ logError }) => logError("ai.tools.tasks", err, { fn: "getTasks" }, "error"));
        return [];
      });
    },
  }),

  // v10.0.515 · #12 Calendar bidirectional · two-tool minimal set.
  // Read uses the existing calendar.readonly scope (already granted).
  // Write goes through a Google-side compose URL the operator clicks
  // to confirm — no calendar.events scope, no AI writing to the
  // calendar without a human hand on the button.

  // ── WRITE TOOLS ──

  createTask: tool({
    description:
      "Create a new task. Use when Nour needs to do something specific. Set `loopKind` to DAILY for habits, PROMISE for commitments to someone (set `promiseTo`), ONCE for one-shot work. Link to a goal via `goalId` so completing it auto-lifts the goal. Example: {\"title\":\"Call Meineke about the lift quote\",\"loopKind\":\"ONCE\",\"priority\":30}",
    // v10.0.529.85 · Wave 29 · audit-driven shape upgrade. Pre-Wave-29
    // this hardcoded loopKind=ONCE with no goal link · no due date ·
    // no promise. Operator saying "add daily workout tied to fitness
    // goal" silently created an orphan ONCE task. All 4 fields now
    // exposed.
    inputSchema: z.object({
      title: z.string(),
      // 2026-07-12 · optional. Was required, which forced the model to supply
      // a mission id it can't reliably know mid-conversation — it hallucinated
      // one, and the FK insert threw (red "TOOL FAILED" card). Omit it (or
      // pass a project id from getMissions) and createTaskAndEnrich files the
      // task into the Inbox, then re-classifies it into the right mission.
      missionId: z
        .string()
        .optional()
        .describe("Optional project/mission id (from getMissions). Omit to auto-file into the Inbox."),
      nextPhysicalAction: z.string().describe("The literal first physical step"),
      effort: z.enum(["M5", "M15", "M30", "H1", "H2PLUS"]).default("M30"),
      context: z.enum(["DESK", "PHONE", "SHOP", "CAR", "HOME", "ANYWHERE"]).default("ANYWHERE"),
      loopKind: z
        .enum(["ONCE", "DAILY", "PROMISE"])
        .default("ONCE")
        .describe("ONCE = one-shot · DAILY = repeats every day · PROMISE = commitment to someone"),
      dueDate: z
        .string()
        .optional()
        .describe("ISO date · only for ONCE + PROMISE · DAILY ignores this"),
      goalId: z
        .string()
        .optional()
        .describe("Link this task to a LifeGoal · completing it auto-lifts the goal's currentValue"),
      promiseTo: z
        .string()
        .optional()
        .describe("For PROMISE kind · who Nour is committing to · 'self', 'dania', a customer name"),
    }),
    execute: async ({
      title,
      missionId,
      nextPhysicalAction,
      effort,
      context,
      loopKind,
      dueDate,
      goalId,
      promiseTo,
    }) => {
      // classification spine · createTaskAndEnrich gap-fills mission/goal/
      // statHints (compare-and-set won't override what the model chose).
      const task = await createTaskAndEnrich({
        title,
        // Empty when the model omits it · createTaskAndEnrich resolves a
        // missing/invalid mission to the Inbox anchor (never FK-throws).
        missionId: missionId ?? "",
        nextPhysicalAction,
        effort,
        roiScore: loopKind === "PROMISE" ? 80 : 50,
        frictionScore: 30,
        energyRequired: "MEDIUM",
        context,
        finishCondition: title,
        loopKind,
        dueDate: dueDate ? new Date(dueDate) : null,
        goalId: goalId ?? null,
        promiseTo: promiseTo ?? null,
      });
      return {
        created: true,
        taskId: task.id,
        title,
        loopKind,
        goalLinked: !!goalId,
        promised: !!promiseTo,
      };
    },
  }),

  completeTask: tool({
    description:
      "Mark a task as done. DAILY tasks bump streak + lastCompletedAt and stay READY (loop reappears tomorrow). ONCE/PROMISE flip to DONE. Example: {\"taskId\":142}",
    // v10.0.529.85 · Wave 29 · CRITICAL fix · pre-Wave-29 this set
    // status:DONE blindly · DAILY tasks lost their streak on every
    // check-off via chat (streak silently killed). Now routes through
    // the same /check pipeline the UI uses · streak preserved.
    inputSchema: z.object({ taskId: z.string() }),
    execute: async ({ taskId }) => {
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: { loopKind: true, streakCount: true, lastCompletedAt: true, status: true, goalId: true },
      });
      if (!task) return { completed: false, error: "task not found" };

      const now = new Date();
      if (task.loopKind === "DAILY") {
        // Same streak logic as /api/tasks/[id]/check route. Day boundaries
        // are ET calendar days (toDateString), NOT server-UTC days — the UTC
        // floor flipped "today" at 8pm ET (double bump / false reset).
        let nextStreak = 1;
        if (task.lastCompletedAt) {
          const lastDayET = toDateString(new Date(task.lastCompletedAt));
          const todayET = toDateString(now);
          const gap = Math.round((Date.parse(todayET) - Date.parse(lastDayET)) / 86_400_000);
          if (gap === 0) {
            return {
              completed: true,
              idempotent: true,
              loopKind: "DAILY",
              streakCount: task.streakCount,
              note: "already checked off today · streak preserved",
            };
          }
          nextStreak = gap === 1 ? task.streakCount + 1 : 1;
        }
        await prisma.task.update({
          where: { id: taskId },
          data: {
            lastCompletedAt: now,
            lastTouchedAt: now,
            streakCount: nextStreak,
            status: "READY", // DAILY stays in the loop
            snoozedUntil: null,
          },
        });

        // credit character-sheet stat XP + lift the linked goal. Awaited via allSettled.
        const settled = await Promise.allSettled([
          creditTaskStats(taskId),
          ...(task.goalId ? [liftGoalOnTaskComplete(task.goalId, taskId)] : []),
        ]);
        for (const r of settled) {
          if (r.status === "rejected") {
            recordError("ai:tool-exec", r.reason, { taskId, op: "task.complete-sideeffect-daily" });
          }
        }

        return {
          completed: true,
          loopKind: "DAILY",
          streakCount: nextStreak,
          taskId,
        };
      }

      // ONCE / PROMISE / etc. → DONE
      await prisma.task.update({
        where: { id: taskId },
        data: {
          status: "DONE",
          lastCompletedAt: now,
          lastTouchedAt: now,
          snoozedUntil: null,
        },
      });

      // credit character-sheet stat XP + lift the linked goal. Awaited via allSettled.
      const settled = await Promise.allSettled([
        creditTaskStats(taskId),
        ...(task.goalId ? [liftGoalOnTaskComplete(task.goalId, taskId)] : []),
      ]);
      for (const r of settled) {
        if (r.status === "rejected") {
          recordError("ai:tool-exec", r.reason, { taskId, op: "task.complete-sideeffect-once" });
        }
      }

      return { completed: true, taskId, loopKind: task.loopKind ?? "ONCE" };
    },
  }),

  // Apr 20 · Natural-language priority retag. Nour can say "bump
  // priority on the battery contract" or "this is critical" and Nick
  // calls this tool. Updates manualPriorityOverride so the auto
  // rebalancer respects the user intent (0-100, HIGHER = more urgent —
  // canonical polarity, see lib/scoring/task-priority). Lookup via
  // taskId (preferred) or fuzzy title match when id is unknown.
  setTaskPriority: tool({
    description:
      "Override the priority of a task to a specific level. Use when Nour explicitly says 'this is critical' / 'low priority' / 'bump priority'. Priority is 0-100 where HIGHER = more urgent (100=drop-everything, 90=critical, 70=high, 50=normal, 30=someday). Example: {\"taskId\":142,\"priority\":90}",
    inputSchema: z.object({
      taskId: z.string().optional().describe("Preferred — the task's id"),
      titleQuery: z
        .string()
        .optional()
        .describe(
          "Fuzzy match against active task titles if taskId unknown. Picks the most recently-touched match."
        ),
      priority: z
        .number()
        .int()
        .min(0)
        .max(100)
        .describe("0-100, higher = more urgent. 100=drop-everything, 90=critical, 70=high, 50=normal, 30=someday."),
      reason: z
        .string()
        .optional()
        .describe("Why Nour set this priority — logged to autoPriorityExplanation for later review."),
    }),
    execute: async ({ taskId, titleQuery, priority, reason }) => {
      let target = taskId
        ? await prisma.task.findUnique({
            where: { id: taskId },
            select: { id: true, title: true, autoPriority: true, manualPriorityOverride: true },
          })
        : null;

      if (!target && titleQuery) {
        // Fuzzy title match on active tasks, newest-touched first
        const candidates = await prisma.task.findMany({
          where: {
            status: { in: ["INBOX", "READY", "DOING", "WAITING"] },
            title: { contains: titleQuery, mode: "insensitive" },
            deletedAt: null,
          },
          orderBy: { lastTouchedAt: "desc" },
          take: 1,
          select: { id: true, title: true, autoPriority: true, manualPriorityOverride: true },
        });
        target = candidates[0] ?? null;
      }

      if (!target) {
        return {
          success: false,
          reason: "task not found",
          hint: "Provide a valid taskId or a more specific titleQuery.",
        };
      }

      const previous = target.manualPriorityOverride ?? target.autoPriority ?? 50;

      await prisma.task.update({
        where: { id: target.id },
        data: {
          manualPriorityOverride: priority,
          autoPriority: priority, // keep in sync so downstream surfaces match
          autoPriorityExplanation: reason
            ? `Nour set priority=${priority}: ${reason.slice(0, 200)}`
            : `Nour set priority=${priority}`,
          lastTouchedAt: new Date(),
        },
      });

      const bandLabel =
        priority >= 80
          ? "critical"
          : priority >= 60
            ? "high"
            : priority >= 40
              ? "normal"
              : "someday";

      return {
        success: true,
        taskId: target.id,
        title: target.title,
        previousPriority: previous,
        newPriority: priority,
        band: bandLabel,
        reason: reason ?? null,
      };
    },
  }),

  resolveAlert: tool({
    description: "Resolve a drift alert",
    inputSchema: z.object({ alertId: z.union([z.string(), z.number()]) }),
    execute: async ({ alertId }) => {
      const { resolveAlert } = await import("@/lib/mastery/drift-engine");
      await resolveAlert(alertId);
      return { resolved: true, alertId };
    },
  }),

  // ─── v10.0.529.85 · Wave 29 · Nick has full control · 5 new tools ───
  // Closes the gap audit found between operator actions on /tasks and
  // what Nick can do from chat. snoozeTask uses the Wave 26 pattern ·
  // archiveGoal uses the Wave 28 fix · logGoalProgress uses GoalEvent ·
  // updateTask covers reframe/move/link in one tool · pinMemory closes
  // the "remember this permanently" conversational loop.

  snoozeTask: tool({
    description:
      "Snooze a task until a future date. Status flips to WAITING + snoozedUntil set · the task-resurface cron flips it back to READY at the wake-up time. Use when Nour says 'snooze this until tomorrow / friday / next week'.",
    inputSchema: z.object({
      taskId: z.string().optional(),
      titleQuery: z
        .string()
        .optional()
        .describe("Fuzzy match against active task titles if taskId unknown."),
      days: z
        .number()
        .int()
        .min(1)
        .max(365)
        .describe("Days from now to wake up · 1 = tomorrow · 7 = next week"),
    }),
    execute: async ({ taskId, titleQuery, days }) => {
      let target = taskId
        ? await prisma.task.findUnique({
            where: { id: taskId },
            select: { id: true, title: true, status: true },
          })
        : null;
      if (!target && titleQuery) {
        const candidates = await prisma.task.findMany({
          where: {
            status: { in: ["INBOX", "READY", "DOING"] },
            title: { contains: titleQuery, mode: "insensitive" },
            deletedAt: null,
          },
          orderBy: { lastTouchedAt: "desc" },
          take: 1,
          select: { id: true, title: true, status: true },
        });
        target = candidates[0] ?? null;
      }
      if (!target) {
        return { success: false, reason: "task not found" };
      }
      const wakeAt = new Date();
      wakeAt.setDate(wakeAt.getDate() + days);
      wakeAt.setHours(7, 0, 0, 0); // resurface at 7am local on the snooze day
      // v10.0.529.97 · Wave 41 · snapshot the pre-mutation state so the
      // undo route can restore exactly. snoozeTask is the highest "wrong
      // target" risk because fuzzy titleQuery can match the wrong row.
      const originalStatus = target.status;
      await prisma.task.update({
        where: { id: target.id },
        data: { status: "WAITING", snoozedUntil: wakeAt, lastTouchedAt: new Date() },
      });
      const label = days === 1 ? "tomorrow" : days === 7 ? "next week" : `${days}d`;
      // v10.0.529.97 · Wave 41 · write a 30s undo token to BrainMemory.
      // POST /api/undo/<token> reads this back · restores status +
      // clears snoozedUntil · soft-deletes the token (one-shot).
      const undoToken = `undo_${target.id}_${Date.now()}`;
      const undoExpiresAt = new Date(Date.now() + 30 * 1000);
      await prisma.brainMemory
        .create({
          data: {
            category: "undo_token",
            key: undoToken,
            content: JSON.stringify({
              toolName: "snoozeTask",
              taskId: target.id,
              originalStatus,
            }),
            source: "chat-tool",
            confidence: 1.0,
            expiresAt: undoExpiresAt,
            createdBy: "nick",
          },
        })
        .catch((err) => {
          void import("@/lib/utils/error-log").then(({ logError }) => logError("ai.tools.tasks", err, { fn: "snoozeTask.undoToken" }, "error"));
          return null;
        });
      return {
        success: true,
        taskId: target.id,
        title: target.title,
        snoozedUntil: wakeAt.toISOString(),
        label,
        undoToken,
        undoExpiresAt: undoExpiresAt.toISOString(),
      };
    },
  }),

  updateTask: tool({
    description:
      "Update task fields · partial mutate (only provided fields change). Covers reframe (title / finishCondition), move (missionId), link/unlink goal (goalId), change kind (loopKind), reschedule (dueDate). Use when Nour says 'reframe this as X', 'move to project Y', 'link to goal Z', 'change to a daily'.",
    inputSchema: z.object({
      taskId: z.string().optional(),
      titleQuery: z.string().optional(),
      title: z.string().optional(),
      finishCondition: z.string().optional(),
      missionId: z.string().optional(),
      goalId: z
        .string()
        .nullable()
        .optional()
        .describe("Set to null to UNLINK from goal · pass an id to link"),
      loopKind: z.enum(["ONCE", "DAILY", "PROMISE"]).optional(),
      dueDate: z.string().nullable().optional().describe("ISO · null to clear"),
    }),
    execute: async ({
      taskId,
      titleQuery,
      title,
      finishCondition,
      missionId,
      goalId,
      loopKind,
      dueDate,
    }) => {
      let target = taskId
        ? await prisma.task.findUnique({ where: { id: taskId }, select: { id: true, title: true } })
        : null;
      if (!target && titleQuery) {
        const candidates = await prisma.task.findMany({
          where: {
            status: { in: ["INBOX", "READY", "DOING", "WAITING"] },
            title: { contains: titleQuery, mode: "insensitive" },
            deletedAt: null,
          },
          orderBy: { lastTouchedAt: "desc" },
          take: 5,
          select: { id: true, title: true },
        });
        
        const exactMatch = candidates.find(c => c.title.toLowerCase() === titleQuery.toLowerCase());
        
        if (exactMatch) {
          target = exactMatch;
        } else if (candidates.length === 1) {
          target = candidates[0] ?? null;
        } else if (candidates.length > 1) {
          return { success: false, reason: `Ambiguous titleQuery '${titleQuery}'. Matches multiple tasks: ${candidates.map(c => c.title).join(" | ")}. Please refine query or use taskId.` };
        }
      }
      if (!target) return { success: false, reason: "task not found" };

      const data: Record<string, unknown> = { lastTouchedAt: new Date() };
      if (title !== undefined) data.title = title;
      if (finishCondition !== undefined) data.finishCondition = finishCondition;
      if (missionId !== undefined) data.missionId = missionId;
      if (goalId !== undefined) data.goalId = goalId; // null = unlink
      if (loopKind !== undefined) data.loopKind = loopKind;
      if (dueDate !== undefined) data.dueDate = dueDate ? new Date(dueDate) : null;

      const updated = await prisma.task.update({
        where: { id: target.id },
        data,
        select: { id: true, title: true, loopKind: true, goalId: true, dueDate: true },
      });

      return {
        success: true,
        taskId: updated.id,
        title: updated.title,
        loopKind: updated.loopKind,
        goalId: updated.goalId,
        dueDate: updated.dueDate?.toISOString() ?? null,
        fieldsChanged: Object.keys(data).filter((k) => k !== "lastTouchedAt"),
      };
    },
  }),

  createCommitment: tool({
    description: "Create a new commitment — a promise made to a specific person with an optional deadline. Example: {\"toWhom\":\"Nick\",\"description\":\"send the Q3 tire order by Friday\",\"deadline\":\"2026-08-15\"}",
    inputSchema: z.object({
      description: z.string(),
      deadline: z.string().optional(),
      toWhom: z.string().default("self"),
      domain: z.string().optional(),
    }),
    execute: async ({ description, deadline, toWhom, domain }) => {
      // Drop hallucinated past-year deadlines (see sanitizeDeadline).
      const { sanitizeDeadline } = await import("@/lib/services/commitments");
      const c = await prisma.commitment.create({
        data: { description, deadline: sanitizeDeadline(deadline), toWhom, domain, dateMade: today() },
      });
      return { created: true, commitmentId: c.id, description };
    },
  }),

  updateCommitment: tool({
    description: "Update a commitment status (kept, broken, deferred)",
    inputSchema: z.object({
      commitmentId: z.number(),
      status: z.enum(["kept", "broken", "deferred"]),
    }),
    execute: async ({ commitmentId, status }) => {
      await prisma.commitment.update({ where: { id: commitmentId }, data: { status } });
      return { updated: true, commitmentId, status };
    },
  }),

  // Apr 19 · logDailyScore retired alongside DailyScore model. The
  // brain-maturity cron now carries the self-model reading; manual
  // score logging is gone. If the agent really wants to capture a
  // subjective daily state, use captureReflection or updateMasteryScore.

  // NOTE: logDecision tool deleted Apr 15 — decision capture is now
  // handled by the natural-language interceptor in /api/ai/chat route.
  // See DECISION_PREFIX_REGEX there: "log this decision: X",
  // "decided to X because Y", "my decision: X" all route directly
  // to masteryDecision.create without a model round-trip.

  completeCommitment: tool({
    description: "Mark a commitment as completed. Use when Nour confirms he did something he promised.",
    inputSchema: z.object({
      commitmentId: z.number().describe("The commitment ID to complete"),
      outcome: z.string().optional().describe("What actually happened"),
    }),
    execute: async ({ commitmentId, outcome }) => {
      await prisma.commitment.update({
        where: { id: commitmentId },
        data: { status: "completed", notes: outcome || "Completed" },
      });
      // BDN-208 · chat-path completions carry conditions too (same
      // fire-and-forget as the service path — never blocks the turn).
      const { captureCommitmentConditions } = await import("@/lib/services/commitment-conditions");
      void captureCommitmentConditions(commitmentId, "completed");
      return { completed: true };
    },
  }),

  // ═══════════════════════════════════════════════════════════
  // DECISION JOURNALING — Auto-log decisions from chat
  // ═══════════════════════════════════════════════════════════

  markCommitmentBroken: tool({
    description: "Mark a commitment as broken and record WHY. Use when Nour admits he didn't keep a commitment. The reason feeds the decision-pattern learning engine.",
    inputSchema: z.object({
      commitmentId: z.number().describe("The commitment id"),
      reason: z.string().min(1).max(500).describe("Why did you break it — be honest"),
    }),
    execute: async ({ commitmentId, reason }) => {
      try {
        const updated = await prisma.commitment.update({
          where: { id: commitmentId },
          data: {
            status: "broken",
            notes: `BROKEN: ${reason}`,
          },
          select: { id: true, description: true, status: true },
        });
        // BDN-208 · broken is the HIGHEST-signal outcome class for the
        // conditions ledger — a break under short_sleep vs rested is
        // exactly the contrast the mechanism exists to expose.
        const { captureCommitmentConditions } = await import("@/lib/services/commitment-conditions");
        void captureCommitmentConditions(commitmentId, "broken");
        return {
          commitmentId: updated.id,
          description: updated.description,
          status: updated.status,
          message: `Commitment marked broken. Logged: "${reason}"`,
        };
      } catch (err) {
        return { error: `Couldn't mark commitment broken: ${String(err)}` };
      }
    },
  }),

  // ─────────────────────────────────────────────────────────────────
  // v11.0 W12.4 · Anti-pattern check. Call BEFORE any side-effecting
  // action (SMS, payment, quote, irreversible writes) when user's
  // intent rhymes with past failures. Greps the library by
  // keyword/tag overlap and returns warnings with severity.
  // ─────────────────────────────────────────────────────────────────
  updateMasteryScore: tool({
    description: "Update a mastery domain score with evidence",
    inputSchema: z.object({
      domain: z.string(),
      score: z.number().min(0).max(10),
      evidence: z.string(),
    }),
    execute: async ({ domain, score, evidence }) => {
      await prisma.masteryScore.upsert({
        where: { date_domain: { date: today(), domain } },
        update: { score, evidence },
        create: { date: today(), domain, score, evidence },
      });
      return { updated: true, domain, score };
    },
  }),

  journalDecision: tool({
    description: "Log a decision Nour just made during this conversation. Records the what, why, stakes, and chosen option so the Decision Pattern Analyzer can learn from it. Use this whenever Nick helps Nour make a choice.",
    inputSchema: z.object({
      title: z.string().describe("Short name for the decision"),
      options: z.string().describe("What options were considered"),
      chosen: z.string().describe("What was chosen and why"),
      stakes: z.enum(["low", "medium", "high"]).describe("How important is this decision"),
      reasoning: z.string().describe("The reasoning behind the choice"),
    }),
    execute: async ({ title, options, chosen, stakes, reasoning }) => {
      const decision = await prisma.masteryDecision.create({
        data: {
          date: today(),
          title,
          context: options,
          chosen,
          stakes,
          reasoning,
        },
      });

      // Also store as brain memory for pattern analysis
      await prisma.brainMemory.create({
        data: {
          category: BRAIN_CATEGORIES.DECISION_LOG,
          key: `decision_${decision.id}`,
          content: `Decision: "${title}" — chose "${chosen}" (${stakes} stakes). Reasoning: ${reasoning}`,
          confidence: 0.8,
          source: "decision_journal",
        },
      }).catch((err) => {
        void import("@/lib/utils/error-log").then(({ logError }) => logError("ai.tools.tasks", err, { fn: "journalDecision.brainMemory" }, "warn"));
      });

      // Silo wave (audit 2026-07-15) · decision→journal bridge. A
      // chat-logged decision previously lived only in mastery_decisions
      // + a decision_log memory — the /journal feed reads
      // decision_replays, so the decision stayed invisible until the
      // replay coach minted a row at REVIEW time (or never). Mint the
      // unreviewed replay stub now with the coach's own idempotencyKey
      // (`decision_<id>_30d`) — markReplayed finds-and-UPDATES this
      // exact row (decision-replay-coach.ts), so no duplicate is ever
      // created, and the decision is feed-visible immediately.
      void (async () => {
        try {
          const reviewAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
          const stub = await prisma.decisionReplay.create({
            data: {
              decisionId: decision.id,
              title,
              context: options,
              choiceMade: chosen,
              reasoning,
              reviewAt,
              reviewed: false,
              idempotencyKey: `decision_${decision.id}_30d`,
            },
            select: { id: true },
          });
          // Durable-fanout wave (audit 2026-07-15) · enrich + embed +
          // thread-join as durable Inngest steps (inline fallback inside).
          const { dispatchJournalFanout } = await import("@/lib/brain/journal-fanout");
          await dispatchJournalFanout("decision_replay", stub.id);
        } catch (err) {
          void import("@/lib/utils/error-log").then(({ logError }) =>
            logError("ai.tools.tasks", err, { fn: "journalDecision.replayStub" }, "warn"),
          );
        }
      })();

      return { logged: true, id: decision.id };
    },
  }),

  // v10.0.75 · sendToTelegram legacy alias retired.
  // tool-families.ts literally labeled it "Alias for sendTelegram (legacy)".
  // Canonical replacement: sendTelegram (defined ~line 1568) which has
  // the same signature and the urgency parameter.

  // ═══════════════════════════════════════════════════════════
  // ESTIMATE TRACKER — The #1 revenue leak detector
  // ═══════════════════════════════════════════════════════════

  logSituation: tool({
    description: "Log a real situation for strategic analysis — AI matches relevant Greene laws and provides tactical advice",
    inputSchema: z.object({
      situation: z.string().describe("What happened or what decision you're facing"),
      context: z.enum(["business", "personal", "negotiation", "conflict", "decision"]),
    }),
    execute: async ({ situation, context }) => {
      const keywords = situation.toLowerCase().split(/\s+/).filter(w => w.length > 4).slice(0, 5);
      const matchingLaws = await prisma.strategicLaw.findMany({
        where: {
          OR: keywords.map(k => ({
            OR: [
              { title: { contains: k, mode: "insensitive" as const } },
              { essence: { contains: k, mode: "insensitive" as const } },
            ],
          })),
        },
        take: 3,
      });
      const situationRow = await prisma.situationLog.create({
        data: { situation, context, lawId: matchingLaws[0]?.id || null },
      });
      // Durable-fanout wave (audit 2026-07-15) · enrich + embed +
      // thread-join as durable Inngest steps (inline fallback inside).
      void (async () => {
        const { dispatchJournalFanout } = await import("@/lib/brain/journal-fanout");
        await dispatchJournalFanout("situation_log", situationRow.id);
      })().catch(() => { /* dispatch never throws · double net */ });
      return {
        logged: true,
        matchingLaws: matchingLaws.map(l => ({
          ref: `${l.book} #${l.number}`,
          title: l.title,
          essence: l.essence?.slice(0, 150),
        })),
        advice: matchingLaws[0]
          ? `Apply ${matchingLaws[0].book} #${matchingLaws[0].number}: ${matchingLaws[0].title}`
          : "No direct law match — analyze the power dynamics at play.",
      };
    },
  }),

  // ═══════════════════════════════════════════════════════
  // TIER 1: MEMORY SEARCH TOOLS (search memories, brain dumps, conversations)
  // ═══════════════════════════════════════════════════════

  getDecisionReplays: tool({
    description: "Get decisions that are due for review. These are past decisions logged for 30/60/90 day replay to evaluate outcomes.",
    inputSchema: z.object({
      includeFuture: z.boolean().default(false).describe("Also show decisions not yet due"),
    }),
    execute: async ({ includeFuture }) => {
      const where: any = { reviewed: false };
      if (!includeFuture) where.reviewAt = { lte: new Date() };
      const replays = await prisma.decisionReplay.findMany({
        where,
        orderBy: { reviewAt: "asc" },
        take: 10,
      });
      return {
        dueCount: replays.length,
        replays: replays.map(r => ({
          id: r.id,
          title: r.title,
          choiceMade: r.choiceMade,
          reasoning: r.reasoning?.slice(0, 200),
          reviewAt: r.reviewAt,
          daysSinceDecision: Math.floor((Date.now() - r.createdAt.getTime()) / 86400000),
        })),
      };
    },
  }),

  // v10.0.528 · Arc B F3 · Decision-Replay Coach.
  // Read-of-record for the queued 30d-replay prompts. Distinct from
  // getDecisionReplays above (which reads the queue table directly)
  // because this surface knows about the coaching prompt + wisdom
  // citation that the daily cron pre-built · operator can ask "any
  // decisions due for review" and get the prompt-ready text back.
  getDecisionsDueForReplay: tool({
    description:
      "List decisions whose 30-day automatic replay is due. Each item carries the pre-composed coaching prompt and (when matched) a wisdom citation. Use when the operator asks 'any decisions due for review' or wants to reflect on past choices.",
    inputSchema: z.object({
      includeConsumed: z
        .boolean()
        .default(false)
        .describe("Also show replays already surfaced in today's morning brief"),
      limit: z.number().int().min(1).max(10).default(5),
    }),
    execute: async ({ includeConsumed, limit }) => {
      const rows = await prisma.brainMemory.findMany({
        where: {
          category: "decision_replay_due",
          deletedAt: null,
        },
        orderBy: { createdAt: "asc" },
        take: Math.max(limit * 2, 10),
        select: {
          id: true,
          key: true,
          content: true,
          metadata: true,
          createdAt: true,
        },
      });
      const filtered = (rows as Array<{
        id: string;
        key: string;
        content: string;
        metadata: Record<string, unknown> | null;
        createdAt: Date;
      }>).filter((r) => {
        if (includeConsumed) return true;
        const meta = r.metadata as Record<string, unknown> | null;
        return !meta?.consumedAt;
      });
      const picked = filtered.slice(0, limit);
      return {
        dueCount: picked.length,
        replays: picked.map((r) => {
          const meta = (r.metadata ?? {}) as Record<string, unknown>;
          return {
            id: r.id,
            decisionId: meta.decisionId ?? null,
            title: (meta.title as string | undefined) ?? r.key,
            ageDays: (meta.ageDays as number | undefined) ?? null,
            wisdomKey: (meta.wisdomKey as string | null | undefined) ?? null,
            prompt: r.content,
            queuedAt: r.createdAt,
          };
        }),
      };
    },
  }),

  reviewDecisionReplay: tool({
    description: "Review a past decision — record what happened, score the outcome, and extract the lesson.",
    inputSchema: z.object({
      replayId: z.string().describe("Decision replay ID to review"),
      outcome: z.string().describe("What actually happened since the decision"),
      outcomeScore: z.number().min(-10).max(10).describe("Net outcome score: -10 (terrible) to +10 (excellent)"),
      lesson: z.string().describe("What was learned from this decision"),
    }),
    execute: async ({ replayId, outcome, outcomeScore, lesson }) => {
      const replay = await prisma.decisionReplay.update({
        where: { id: replayId },
        data: { outcome, outcomeScore, lesson, reviewed: true, reviewedAt: new Date() },
      });
      // Store the lesson as a brain memory for future reference
      await prisma.brainMemory.create({
        data: {
          category: BRAIN_CATEGORIES.LESSON,
          key: `decision_replay_${replay.title.slice(0, 30)}`,
          content: `Decision: ${replay.title}. Choice: ${replay.choiceMade}. Outcome (${outcomeScore}/10): ${outcome}. Lesson: ${lesson}`,
          source: "decision_replay",
          confidence: Math.min(0.95, 0.7 + Math.abs(outcomeScore) * 0.025),
        },
      });
      return { reviewed: true, title: replay.title, outcomeScore, lessonStored: true };
    },
  }),

  // ═══════════════════════════════════════════════════════
  // TIER 3: MISSION PLANNING + ARSENAL SDK TOOLS
  // ═══════════════════════════════════════════════════════

  scheduleFollowUp: tool({
    description: "Schedule a customer follow-up task with a deadline. Use when Nour says 'follow up with X in N days' or 'remind me to call customer Y'. Creates a task in the Inbox mission with a due date.",
    inputSchema: z.object({
      customerName: z.string().min(1).describe("Customer to follow up with"),
      daysFromNow: z.number().min(0).max(180).default(3).describe("How many days from now the follow-up is due"),
      note: z.string().optional().describe("What the follow-up is about"),
      effort: z.enum(["M5", "M15", "M30", "H1", "H2PLUS"]).default("M15"),
    }),
    execute: async ({ customerName, daysFromNow, note, effort }) => {
      // Resolve (or create) the Inbox mission for ad-hoc follow-ups.
      let inbox = await prisma.mission.findFirst({
        where: { title: "Inbox", status: "ACTIVE", deletedAt: null },
        select: { id: true },
      });
      if (!inbox) {
        inbox = await prisma.mission.create({
          data: {
            title: "Inbox",
            domain: "BUSINESS",
            status: "ACTIVE",
            priority: 50,
            roiScore: 50,
            neglectCost: 30,
          },
          select: { id: true },
        });
      }
      const due = new Date();
      due.setDate(due.getDate() + daysFromNow);
      const title = `Follow up with ${customerName}${note ? ` — ${note}` : ""}`;
      const task = await createTaskAndEnrich({
        title,
        missionId: inbox.id,
        nextPhysicalAction: `Call / text ${customerName}`,
        effort,
        roiScore: 70,
        frictionScore: 20,
        energyRequired: "MEDIUM",
        context: "PHONE",
        finishCondition: `${customerName} responded or explicitly declined`,
        dueDate: due,
        waitingOn: customerName,
      });
      return {
        taskId: task.id,
        title: task.title,
        dueDate: task.dueDate,
        customerName,
        message: `Follow-up scheduled for ${daysFromNow === 0 ? "today" : daysFromNow === 1 ? "tomorrow" : `in ${daysFromNow} days`}: "${title}"`,
      };
    },
  }),

  /**
   * Triage a stale lead — mark it dead, recovered, or still-active
   * with a specific reason. This closes the loop on the
   * revenue-loss-diagnosis problem: stale leads used to just rot in
   * NEW status forever. Now Nick can formally classify them.
   */
  rankNextActions: tool({
    description: "Rank the top N open tasks by impact × ease × freshness. Use when Nour says 'what should I do next' or when there are more than 5 open tasks. Returns a sorted list with score + reasoning.",
    inputSchema: z.object({
      limit: z.number().min(1).max(20).default(5).describe("How many to return"),
    }),
    execute: async ({ limit }) => {
      const tasks = await prisma.task.findMany({
        where: { status: { in: ["INBOX", "READY", "DOING"] }, deletedAt: null },
        include: { mission: { select: { title: true, domain: true } } },
      });
      const now = Date.now();
      const scored = tasks.map((t) => {
        const ageDays = Math.floor((now - t.createdAt.getTime()) / 86400000);
        const frictionInverse = 100 - (t.frictionScore ?? 50);
        // Age boost: peaks at 3-5 days old, decays after.
        const ageBoost = ageDays <= 1 ? 20 : ageDays <= 5 ? 40 : ageDays <= 14 ? 30 : 10;
        let score = (t.roiScore ?? 50) * 0.6 + frictionInverse * 0.3 + ageBoost * 0.1;
        // DOING tasks always rise to the top — finish what you started.
        if (t.status === "DOING") score += 50;
        return {
          id: t.id,
          title: t.title,
          mission: t.mission?.title,
          domain: t.mission?.domain,
          status: t.status,
          effort: t.effort,
          nextPhysicalAction: t.nextPhysicalAction,
          ageDays,
          roiScore: t.roiScore,
          frictionScore: t.frictionScore,
          score: Math.round(score),
        };
      });
      scored.sort((a, b) => b.score - a.score);
      return {
        count: Math.min(scored.length, limit),
        topActions: scored.slice(0, limit),
        totalOpen: tasks.length,
      };
    },
  }),

  /**
   * Create a follow-up task with a deadline for a customer. This
   * closes the common loop where Nour says "remind me to call X in
   * 3 days" — used to be 3 tool calls (create task, set due date,
   * optionally send SMS). Now one call.
   */
  decisionPreFlight: tool({
    description: "Run a decision pre-flight checklist before any high-stakes decision. Checks emotional state, recent patterns, time-of-day risk, and provides a go/wait/no-go recommendation. Use when Nour says 'should I', 'I'm thinking about', or faces a significant choice.",
    inputSchema: z.object({
      decision: z.string().describe("What decision is being considered"),
      stakes: z.enum(["low", "medium", "high", "critical"]).default("medium"),
      reversible: z.boolean().default(true).describe("Can this decision be undone?"),
    }),
    execute: async ({ decision, stakes, reversible }) => {
      const now = new Date();
      const hour = now.getHours();
      const dayOfWeek = now.getDay();

      // Check recent emotional state
      // v10.0.54 · Replaces retired DailyScore lookup. Source is now
      // identity_snapshot history (7d) for energy + mood, falling back
      // to BodyTracking moodScore when the snapshot lacks them.
      // Snapshot content is JSON with {energy?, mood?, score?} keys.
      const recentSnapshots = await prisma.brainMemory
        .findMany({
          where: {
            category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT,
            deletedAt: null,
            updatedAt: { gte: daysAgo(7) },
          },
          orderBy: { updatedAt: "desc" },
          select: { content: true, updatedAt: true },
        })
        .catch((): Array<{ content: string; updatedAt: Date }> => []);
      const recentScores: Array<{ energyLevel: number; mood: string | null }> = [];
      for (const row of recentSnapshots) {
        try {
          const parsed = JSON.parse(row.content) as { energy?: number; mood?: string };
          recentScores.push({
            energyLevel: typeof parsed.energy === "number" ? parsed.energy : 5,
            mood: typeof parsed.mood === "string" ? parsed.mood : null,
          });
        } catch {
          // Skip malformed
        }
      }

      // Check active tasks + commitments (cognitive load)
      // deletedAt:null on all three — these drive risk GATES (openLoops > 8
      // ⇒ "SCATTERED", activeCommitments > 5, recentDecisions > 5 ⇒ "DECISION
      // FATIGUE"). With 104 of 161 Task rows soft-deleted, the SCATTERED gate
      // was firing on tombstones — a chronic false NO-GO.
      const [openLoops, activeCommitments] = await Promise.all([
        prisma.task.count({ where: { status: { in: ["INBOX", "READY", "DOING"] }, deletedAt: null } }),
        prisma.commitment.count({ where: { status: { in: ["active", "in_progress"] }, deletedAt: null } }),
      ]);

      // Check recent decisions for overcommit pattern
      const recentDecisions = await prisma.masteryDecision.count({
        where: {
          date: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0] },
          deletedAt: null,
        },
      });

      // Build risk factors
      const risks: string[] = [];
      let riskScore = 0;

      // Time-of-day risk
      if (hour >= 20) { risks.push("EVENING GATE: Decision quality drops after 8pm. Sleep on it."); riskScore += 3; }
      else if (hour >= 16 && hour < 20) { risks.push("Afternoon fade — focus is lower. Double-check reasoning."); riskScore += 1; }

      // Emotional state
      if (recentScores.length === 0) { risks.push("NO RECENT SCORES: Can't assess emotional state. Log a score first."); riskScore += 2; }
      else {
        const avgEnergy = recentScores.reduce((s, r) => s + (r.energyLevel || 5), 0) / recentScores.length;
        const latestMood = recentScores[0]?.mood;
        if (avgEnergy < 4) { risks.push(`LOW ENERGY (avg ${avgEnergy.toFixed(1)}/10). Poor decisions happen when tired.`); riskScore += 2; }
        if (latestMood === "stressed" || latestMood === "anxious") { risks.push(`ELEVATED STRESS: Current mood is ${latestMood}. Stress narrows options.`); riskScore += 2; }
        if (latestMood === "irritable") { risks.push("IRRITABLE: High risk of reactive decisions. Wait 24h."); riskScore += 3; }
      }

      // Cognitive load
      if (openLoops > 8) { risks.push(`SCATTERED: ${openLoops} open loops. Adding more increases drop risk.`); riskScore += 2; }
      if (activeCommitments > 5) { risks.push(`OVERCOMMITTED: ${activeCommitments} active commitments. Can you actually follow through?`); riskScore += 1; }
      if (recentDecisions > 5) { risks.push(`DECISION FATIGUE: ${recentDecisions} decisions this week. Quality declines with quantity.`); riskScore += 1; }

      // Weekend
      if (dayOfWeek === 0 || dayOfWeek === 6) { risks.push("WEEKEND: Is this urgent or can it wait until Monday with fresh eyes?"); }

      // Stakes multiplier
      if (stakes === "critical" && !reversible) riskScore *= 2;
      else if (stakes === "high") riskScore = Math.ceil(riskScore * 1.5);

      // Recommendation
      let recommendation: string;
      if (riskScore >= 8) recommendation = "NO-GO: Too many risk factors active. Wait 24-48h minimum.";
      else if (riskScore >= 4) recommendation = "WAIT: Proceed only if time-sensitive. Otherwise sleep on it.";
      else recommendation = "GO: Conditions are favorable. Decide with confidence.";

      return {
        decision,
        stakes,
        reversible,
        riskScore,
        recommendation,
        risks: risks.length > 0 ? risks : ["No significant risk factors detected."],
        context: {
          timeOfDay: hour < 12 ? "morning (peak)" : hour < 17 ? "afternoon" : "evening (risky)",
          recentScoresAvailable: recentScores.length,
          openLoops,
          activeCommitments,
          decisionsThisWeek: recentDecisions,
        },
        advice: reversible
          ? "This is reversible — bias toward action. You can adjust."
          : "This is IRREVERSIBLE — bias toward caution. Get a second opinion.",
      };
    },
  }),

  // ═══════════════════════════════════════════════════════════════
  // ENRICHMENT TOOLS v1 — writes for daily-driver ops
  //
  // Added after the 2026-04 tool audit. Each one closes a gap where
  // Nick had read access but no way to actually write the thing. The
  // setMit/clearMit tools return a clientAction payload that the chat
  // page watches for and mirrors to localStorage (MIT is client-owned
  // state — see components/actions/mit-contract.tsx).
  // ═══════════════════════════════════════════════════════════════

  /**
   * Lock today's MIT (Most Important Thing). Returns a client-action
   * directive that the chat page applies to localStorage (same shape
   * as MitContract). Nour's MIT is client-owned, so the tool is a
   * thin adapter — the authoritative write happens in the browser.
   */
  setMit: tool({
    description: "Lock today's Most Important Thing (MIT). Nour picks ONE commitment per day; this tool writes it. Example args: { text: 'Close the Smith estimate before EOD' }",
    inputSchema: z.object({
      text: z.string().min(1).max(200).describe("The single most important thing to get done today"),
    }),
    execute: async ({ text }) => {
      const trimmed = text.trim().slice(0, 140);
      return {
        clientAction: "setMit" as const,
        text: trimmed,
        message: `MIT set: "${trimmed}". Locked until midnight Cleveland.`,
      };
    },
  }),

  /**
   * Clear today's MIT. Same client-mirror pattern as setMit.
   */
  clearMit: tool({
    description: "Clear today's MIT so Nour can pick a new one. Usually only called if Nour explicitly says the MIT is wrong.",
    inputSchema: z.object({}),
    execute: async () => {
      return {
        clientAction: "clearMit" as const,
        message: "MIT cleared. Pick a new one.",
      };
    },
  }),

  /**
   * Live blind-spot detector wrapper — surfaces severity-ranked
   * blind spots (overdue commitments, stale leads, scoring gaps,
   * neglected relationships, drift alert pile-up).
   *
   * Wraps lib/brain/blind-spot-detector.ts#detectBlindSpots which
   * runs ~10 parallel Prisma queries and ranks by severity.
   */

  // ═══════════════════════════════════════════════════════════
  // COMMITMENT FOLLOW-THROUGH — Track and check on promises
  // ═══════════════════════════════════════════════════════════

  checkCommitments: tool({
    description: "Check all active commitments — what's on track, what's overdue, what needs follow-up. Use proactively to hold Nour accountable.",
    inputSchema: z.object({}),
    execute: async () => {
      const commitments = await prisma.commitment.findMany({
        where: { status: { in: ["active", "in_progress"] }, deletedAt: null },
        orderBy: { createdAt: "desc" },
        select: { id: true, description: true, deadline: true, status: true, dateMade: true, toWhom: true },
      });

      const todayStr = today();
      const overdue = commitments.filter(c => c.deadline && c.deadline < todayStr);
      const upcoming = commitments.filter(c => c.deadline && c.deadline >= todayStr && c.deadline <= toDateString(daysAgo(-3)));
      const open = commitments.filter(c => !c.deadline);

      return {
        total: commitments.length,
        overdue: overdue.map(c => ({ description: c.description, deadline: c.deadline, daysPast: Math.floor((Date.now() - new Date(c.deadline + "T12:00:00").getTime()) / 86400000) })),
        dueSoon: upcoming.map(c => ({ description: c.description, deadline: c.deadline })),
        openEnded: open.map(c => ({ description: c.description, dateMade: c.dateMade })),
      };
    },
  }),

  suggestMIT: tool({
    description: "Suggest the Most Important Task right now based on all available data — critical tasks, urgent leads, daily score",
    inputSchema: z.object({}),
    execute: async () => {
      // Check critical tasks
      const criticalTask = await prisma.task.findFirst({
        where: { status: { in: ["READY", "DOING"] }, deletedAt: null },
        orderBy: [{ dueDate: "asc" }],
      });

      // Check bridge for urgent leads
      const { fetchShopSnapshot } = await import("@/lib/services/bridge");
      const shop = await fetchShopSnapshot().catch((): null => null);

      const suggestions: string[] = [];
      if (shop?.leads?.urgentCount && shop.leads.urgentCount > 0)
        suggestions.push(`🔴 ${shop.leads.urgentCount} urgent shop leads need contact NOW`);
      if (shop?.callbacks?.pendingCount && shop.callbacks.pendingCount > 3)
        suggestions.push(`📞 ${shop.callbacks.pendingCount} callbacks pending`);
      if (criticalTask)
        suggestions.push(`📋 Task: ${criticalTask.title}${criticalTask.dueDate ? ` (due ${criticalTask.dueDate.toLocaleDateString()})` : ""}`);

      // v10.0.54 · Wave A · Replaces retired DailyScore lookup. Today's
      // identity-snapshot updatedAt is the engagement signal — if the
      // current snapshot was rolled today (cron @ 4:30am ET refreshes
      // it; manual mastery surface engagement also touches it), Nour
      // is engaged. If not, prompt the score nudge.
      const todayStartET = new Date(
        new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }) + "T00:00:00",
      );
      const snap = await prisma.brainMemory
        .findUnique({
          where: { category_key: { category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT, key: "current" } },
          select: { updatedAt: true, deletedAt: true },
        })
        .catch((): null => null);
      const engagedToday = !!snap && !snap.deletedAt && snap.updatedAt >= todayStartET;
      if (!engagedToday) suggestions.push("⚡ Daily score not started — complete non-negotiables");

      return suggestions.length > 0
        ? { mit: suggestions[0], others: suggestions.slice(1) }
        : { mit: "All clear — no critical items. Use this time for strategic work.", others: [] };
    },
  }),

  dailyPulse: tool({
    description: "One-shot daily status — everything Nour needs in 30 seconds. Revenue + alerts + leads + callbacks + work orders + bookings + tasks + score + drift. Use when Nour says 'status', 'pulse', 'how are we doing', 'what's up', 'how's the shop', or 'what's going on today'. v10.0.79 supersedes the narrower getShopBriefing.",
    inputSchema: z.object({}),
    execute: async () => {
      const { queryNickBatch } = await import("@/lib/nickstire/query");
      const [shopData, todayScore, criticalTasks, driftAlerts] = await Promise.all([
        // v10.0.79 · expanded to 6 shop queries to fully cover the
        // retired getShopBriefing's surface (added work_orders_active
        // + bookings_today). dailyPulse is now a strict superset.
        queryNickBatch([
          { query: "revenue_today" },
          { query: "attention_needed" },
          { query: "leads_urgent" },
          { query: "callbacks_pending" },
          { query: "work_orders_active" },
          { query: "bookings_today" },
        ]),
        // v10.0.54 · todayScore replaced with identity_snapshot read.
        // The retired DailyScore.{overallScore, energyLevel, focusQuality,
        // mood} fields are now rolled into the identity_snapshot JSON
        // content; we parse and surface those four keys for the
        // downstream return shape.
        prisma.brainMemory
          .findUnique({
            where: { category_key: { category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT, key: "current" } },
            select: { content: true, updatedAt: true, deletedAt: true },
          })
          .then((row) => {
            if (!row || row.deletedAt) return null;
            try {
              const parsed = JSON.parse(row.content) as {
                score?: number;
                energy?: number;
                focus?: number;
                mood?: string;
              };
              return {
                overallScore: parsed.score ?? null,
                energyLevel: parsed.energy ?? null,
                focusQuality: parsed.focus ?? null,
                mood: parsed.mood ?? null,
              };
            } catch {
              return null;
            }
          })
          .catch((): null => null),
        prisma.task.findMany({ where: { status: { in: ["READY", "DOING"] }, deletedAt: null }, orderBy: { autoPriority: { sort: "desc", nulls: "last" } }, take: 5 }).catch((): never[] => []),
        (async () => {
          const { getUnresolvedAlerts } = await import("@/lib/mastery/drift-engine");
          return getUnresolvedAlerts().catch(() => []);
        })(),
      ]);

      return {
        shop: shopData,
        personal: {
          dailyScore: todayScore?.overallScore ?? "not logged",
          energy: todayScore?.energyLevel ?? "?",
          focus: todayScore?.focusQuality ?? "?",
          mood: todayScore?.mood ?? "?",
        },
        tasks: criticalTasks.map(t => ({ title: t.title, status: t.status, priority: t.autoPriority })),
        driftAlerts: driftAlerts.map(a => ({ rule: a.ruleName, severity: a.severity, msg: a.message })),
      };
    },
  }),

  endOfDay: tool({
    description: "End-of-day debrief — revenue summary, what got done, what's still open, drift check. Use when Nour says 'EOD', 'end of day', 'closing time', 'wrap up'",
    inputSchema: z.object({}),
    execute: async () => {
      const { queryNickBatch } = await import("@/lib/nickstire/query");
      const [shopData, todayScore, completedToday, stillOpen, commitments] = await Promise.all([
        queryNickBatch([
          { query: "revenue_today" },
          { query: "bookings_today" },
          { query: "leads_today" },
          { query: "attention_needed" },
        ]),
        // v10.0.54 · todayScore replaced with identity_snapshot read.
        prisma.brainMemory
          .findUnique({
            where: { category_key: { category: BRAIN_CATEGORIES.IDENTITY_SNAPSHOT, key: "current" } },
            select: { content: true, updatedAt: true, deletedAt: true },
          })
          .then((row) => {
            if (!row || row.deletedAt) return null;
            try {
              const parsed = JSON.parse(row.content) as { score?: number };
              return { overallScore: parsed.score ?? null };
            } catch {
              return null;
            }
          })
          .catch((): null => null),
        prisma.task.findMany({ where: { status: "DONE", updatedAt: { gte: daysAgo(0) }, deletedAt: null } }).catch((): never[] => []),
        prisma.task.findMany({ where: { status: { in: ["READY", "DOING"] }, deletedAt: null } }).catch((): never[] => []),
        prisma.commitment.findMany({ where: { status: { in: ["active", "in_progress"] }, deletedAt: null } }).catch((): Array<{ id: number; deadline: string | null; description: string; status: string }> => []),
      ]);

      return {
        shop: shopData,
        personal: {
          dailyScore: todayScore?.overallScore ?? "not scored yet — log your day",
          tasksCompleted: completedToday.length,
          tasksRemaining: stillOpen.length,
          activeCommitments: commitments.length,
        },
        completedTasks: completedToday.map(t => t.title),
        openTasks: stillOpen.slice(0, 5).map(t => ({ title: t.title, status: t.status })),
        commitmentsDue: commitments.filter(c => c.deadline && new Date(c.deadline) <= daysAgo(-1)).map(c => c.description),
      };
    },
  }),

  // ═══════════════════════════════════════════════════════════
  // WEEKLY TARGETS — Track 3 weekly goals (revenue, personal, health)
  // ═══════════════════════════════════════════════════════════

};

export const tasksTools = {
  ...tasksCoreTools,
  ...goalsTools,
  ...missionsTools,
  ...habitsTools,
  ...healthTools,
  ...financeTools,
  ...calendarTools,
};
