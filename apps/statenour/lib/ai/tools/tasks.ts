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
 */

import { tool } from "ai";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { today, daysAgo, toDateString } from "@/lib/utils/datetime";
import { detectBlindSpots } from "@/lib/brain/blind-spot-detector";

export const tasksTools = {
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
      return prisma.driftAlert.findMany({ where: { resolved: false }, orderBy: { date: "desc" } }).catch((): never[] => []);
    },
  }),

  getCommitments: tool({
    description: "Get active commitments",
    inputSchema: z.object({}),
    execute: async () => {
      return prisma.commitment.findMany({ where: { status: { in: ["active", "in_progress"] }, deletedAt: null } }).catch((): never[] => []);
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
        orderBy: { autoPriority: "desc" },
      }).catch((): never[] => []);
    },
  }),

  getMissions: tool({
    description: "Get active missions",
    inputSchema: z.object({}),
    execute: async () => {
      // v10.0.529.94 · Wave 38 · field projection.
      return prisma.mission.findMany({
        where: { status: "ACTIVE", deletedAt: null },
        select: { id: true, title: true, domain: true, priority: true, status: true },
        orderBy: { priority: "desc" },
      }).catch((): never[] => []);
    },
  }),

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
        .catch((): Array<{ title: string; streakCount: number; lastCompletedAt: Date | null }> => []);
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

  getBodyData: tool({
    description: "Get recent body tracking entries",
    inputSchema: z.object({ days: z.number().min(1).max(365).default(30) }),
    execute: async ({ days }) => {
      return prisma.bodyTracking.findMany({
        where: { date: { gte: toDateString(daysAgo(days)) } },
        orderBy: { date: "desc" },
      }).catch((): never[] => []);
    },
  }),

  getFinancialSnapshot: tool({
    description: "Get the latest financial snapshot",
    inputSchema: z.object({}),
    execute: async () => {
      return prisma.financialSnapshot.findFirst({ orderBy: { date: "desc" } }).catch((): null => null);
    },
  }),

  // v10.0.515 · #12 Calendar bidirectional · two-tool minimal set.
  // Read uses the existing calendar.readonly scope (already granted).
  // Write goes through a Google-side compose URL the operator clicks
  // to confirm — no calendar.events scope, no AI writing to the
  // calendar without a human hand on the button.

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
          const since = new Date(Date.now() - 30 * 86400000).toISOString();
          const res = await queryNick<{ totalDollars?: number }>("revenue_range", { since });
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

  getTodaySchedule: tool({
    description:
      "Get the operator's Google Calendar events for today and the next few days. Returns event titles, times, locations, attendees. Use when answering 'what's on my schedule', 'when is X meeting', or reasoning about availability.",
    inputSchema: z.object({
      daysAhead: z
        .number()
        .int()
        .min(0)
        .max(14)
        .optional()
        .describe("How many days forward to fetch. Default 1 (today + tomorrow)."),
    }),
    execute: async ({ daysAhead }) => {
      try {
        const { listEvents, CalendarApiError } = await import(
          "@/lib/services/calendar-api"
        );
        const events = await listEvents({
          daysAhead: daysAhead ?? 1,
          maxResults: 50,
        });
        return {
          ok: true,
          count: events.length,
          events: events.map((e) => ({
            id: e.id,
            summary: e.summary ?? "(no title)",
            start: e.start ?? null,
            end: e.end ?? null,
            location: e.location ?? null,
            attendees: e.attendees ?? [],
            link: e.htmlLink ?? null,
          })),
        };
      } catch (err) {
        // Typed error from calendar-api distinguishes scope/auth issues.
        const e = err as { tag?: string; status?: number; message?: string };
        if (e?.tag === "scope_or_api_disabled") {
          return {
            ok: false,
            code: "scope_missing",
            error:
              "Calendar access not granted. Reconnect Google with calendar.readonly scope via /api/oauth/google-data/start.",
          };
        }
        if (e?.tag === "auth") {
          return {
            ok: false,
            code: "auth",
            error: "Google OAuth token invalid. Reconnect via /api/oauth/google-data/start.",
          };
        }
        return {
          ok: false,
          code: "unknown",
          error: e?.message ?? "Calendar fetch failed.",
        };
      }
    },
  }),

  // v10.0.524 · #10 Anti-pattern surfacing tool. The operator's
  // brain already auto-promotes D/F decisions to anti-patterns
  // (lib/brain/anti-pattern-auto-promote.ts) but they only show
  // in /system/anti-patterns. Surface them in-chat so Nick can
  // proactively warn ("you said X two weeks ago and broke it").
  proposeCalendarEvent: tool({
    description:
      "Propose a new Google Calendar event. Returns a 'create event' URL with all fields pre-filled. The operator clicks the URL to confirm and create — Nick never writes to the calendar without a human in the loop. Use when Nick suggests scheduling something concrete (a focus block, a meeting, a follow-up).",
    inputSchema: z.object({
      title: z.string().min(2).max(120).describe("Event title."),
      startISO: z
        .string()
        .describe(
          "Event start in ISO 8601 (e.g. '2026-05-13T14:00:00-04:00'). If timezone omitted, operator's local zone is assumed.",
        ),
      endISO: z
        .string()
        .optional()
        .describe("Event end in ISO 8601. If omitted, defaults to startISO + 60 minutes."),
      location: z.string().max(200).optional().describe("Physical or virtual location."),
      description: z
        .string()
        .max(1000)
        .optional()
        .describe("Event description / agenda / notes."),
      attendees: z
        .array(z.string().email())
        .max(20)
        .optional()
        .describe("Attendee email addresses."),
    }),
    execute: async ({ title, startISO, endISO, location, description, attendees }) => {
      try {
        const start = new Date(startISO);
        if (isNaN(start.getTime())) {
          return { ok: false, error: "Invalid startISO" };
        }
        const end = endISO ? new Date(endISO) : new Date(start.getTime() + 60 * 60_000);
        if (isNaN(end.getTime()) || end.getTime() <= start.getTime()) {
          return { ok: false, error: "Invalid endISO (must be after startISO)" };
        }
        // Google Calendar event-compose URL format. dates= uses
        // the YYYYMMDDTHHmmssZ form in UTC.
        const fmt = (d: Date) => d.toISOString().replace(/[-:]|\.\d{3}/g, "");
        const params = new URLSearchParams({
          action: "TEMPLATE",
          text: title,
          dates: `${fmt(start)}/${fmt(end)}`,
        });
        if (location) params.set("location", location);
        if (description) params.set("details", description);
        if (attendees && attendees.length > 0) {
          params.set("add", attendees.join(","));
        }
        const composeUrl = `https://calendar.google.com/calendar/render?${params.toString()}`;
        return {
          ok: true,
          composeUrl,
          summary: title,
          start: start.toISOString(),
          end: end.toISOString(),
          // Nick should render the composeUrl as a button in his
          // reply: "Open in Google Calendar →". Operator clicks
          // once to confirm and the event is created.
          instructions:
            "Render the composeUrl as a clickable 'Add to Calendar' link in the reply.",
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  }),

  // ── WRITE TOOLS ──

  addTasksToProject: tool({
    description: "Create multiple tasks under a mission (project) in bulk. Use when Nour needs to break down a project into several specific tasks at once.",
    inputSchema: z.object({
      missionId: z.string(),
      tasks: z.array(z.object({
        title: z.string(),
        nextPhysicalAction: z.string().describe("The literal first physical step"),
        effort: z.enum(["M5", "M15", "M30", "H1", "H2PLUS"]).default("M30"),
        context: z.enum(["DESK", "PHONE", "SHOP", "CAR", "HOME", "ANYWHERE"]).default("ANYWHERE"),
      })).min(1),
    }),
    execute: async ({ missionId, tasks }) => {
      const createdTasks = [];
      for (const t of tasks) {
        const task = await prisma.task.create({
          data: {
            title: t.title,
            missionId,
            nextPhysicalAction: t.nextPhysicalAction,
            effort: t.effort,
            roiScore: 50,
            frictionScore: 30,
            energyRequired: "MEDIUM",
            context: t.context,
            finishCondition: t.title,
          },
        });
        createdTasks.push({ taskId: task.id, title: task.title });
      }
      return { created: true, count: createdTasks.length, missionId, tasks: createdTasks };
    },
  }),

  createTask: tool({
    description:
      "Create a new task. Use when Nour needs to do something specific. Set `loopKind` to DAILY for habits, PROMISE for commitments to someone (set `promiseTo`), ONCE for one-shot work. Link to a goal via `goalId` so completing it auto-lifts the goal.",
    // v10.0.529.85 · Wave 29 · audit-driven shape upgrade. Pre-Wave-29
    // this hardcoded loopKind=ONCE with no goal link · no due date ·
    // no promise. Operator saying "add daily workout tied to fitness
    // goal" silently created an orphan ONCE task. All 4 fields now
    // exposed.
    inputSchema: z.object({
      title: z.string(),
      missionId: z.string(),
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
      const task = await prisma.task.create({
        data: {
          title,
          missionId,
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
        },
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
      "Mark a task as done. DAILY tasks bump streak + lastCompletedAt and stay READY (loop reappears tomorrow). ONCE/PROMISE flip to DONE.",
    // v10.0.529.85 · Wave 29 · CRITICAL fix · pre-Wave-29 this set
    // status:DONE blindly · DAILY tasks lost their streak on every
    // check-off via chat (streak silently killed). Now routes through
    // the same /check pipeline the UI uses · streak preserved.
    inputSchema: z.object({ taskId: z.string() }),
    execute: async ({ taskId }) => {
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        select: { loopKind: true, streakCount: true, lastCompletedAt: true, status: true },
      });
      if (!task) return { completed: false, error: "task not found" };

      const now = new Date();
      if (task.loopKind === "DAILY") {
        // Same streak logic as /api/tasks/[id]/check route
        let nextStreak = 1;
        if (task.lastCompletedAt) {
          const last = new Date(task.lastCompletedAt);
          const lastStart = new Date(last.getFullYear(), last.getMonth(), last.getDate());
          const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          const gap = Math.round((todayStart.getTime() - lastStart.getTime()) / 86_400_000);
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
      return { completed: true, taskId, loopKind: task.loopKind ?? "ONCE" };
    },
  }),

  // Apr 20 · Natural-language priority retag. Nour can say "bump
  // priority on the battery contract" or "this is critical" and Nick
  // calls this tool. Updates manualPriorityOverride so the auto
  // rebalancer respects the user intent (0-100, lower = more urgent).
  // Lookup via taskId (preferred) or fuzzy title match when id is
  // unknown.
  setTaskPriority: tool({
    description:
      "Override the priority of a task to a specific level. Use when Nour explicitly says 'this is critical' / 'low priority' / 'bump priority'. Priority is 0-100 where lower = more urgent (0=drop-everything, 15=critical, 30=high, 50=normal, 70=someday).",
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
        .describe("0-100. 0=drop-everything, 15=critical, 30=high, 50=normal, 70=someday."),
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
        priority <= 15
          ? "critical"
          : priority <= 30
            ? "high"
            : priority <= 60
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
    inputSchema: z.object({ alertId: z.number() }),
    execute: async ({ alertId }) => {
      await prisma.driftAlert.update({ where: { id: alertId }, data: { resolved: true, resolvedDate: today() } });
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
        .catch(() => null);
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
          take: 1,
          select: { id: true, title: true },
        });
        target = candidates[0] ?? null;
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
    description: "Create a new commitment",
    inputSchema: z.object({
      description: z.string(),
      deadline: z.string().optional(),
      toWhom: z.string().default("self"),
      domain: z.string().optional(),
    }),
    execute: async ({ description, deadline, toWhom, domain }) => {
      const c = await prisma.commitment.create({
        data: { description, deadline, toWhom, domain, dateMade: today() },
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
        const task = await prisma.task.create({
          data: {
            title: t.title,
            missionId: mission.id,
            nextPhysicalAction: t.nextPhysicalAction,
            effort: t.effort,
            context: t.context,
            finishCondition: t.title,
            roiScore: Math.max(10, 90 - i * 10),
            frictionScore: 30,
            energyRequired: "MEDIUM",
          },
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
          category: "decision_log",
          key: `decision_${decision.id}`,
          content: `Decision: "${title}" — chose "${chosen}" (${stakes} stakes). Reasoning: ${reasoning}`,
          confidence: 0.8,
          source: "decision_journal",
        },
      }).catch(() => {});

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
      await prisma.situationLog.create({
        data: { situation, context, lawId: matchingLaws[0]?.id || null },
      });
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
          category: "lesson",
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
      const task = await prisma.task.create({
        data: {
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
        },
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
            category: "identity_snapshot",
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
      const [openLoops, activeCommitments] = await Promise.all([
        prisma.task.count({ where: { status: { in: ["INBOX", "READY", "DOING"] } } }),
        prisma.commitment.count({ where: { status: { in: ["active", "in_progress"] } } }),
      ]);

      // Check recent decisions for overcommit pattern
      const recentDecisions = await prisma.masteryDecision.count({
        where: { date: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0] } },
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
  setWeeklyTargets: tool({
    description: "Set this week's 3 targets. Call on Monday or when Nour wants to set goals. Stores them so you can reference mid-week.",
    inputSchema: z.object({
      revenue: z.string().describe("Revenue/business target for the week"),
      personal: z.string().describe("Personal/growth target for the week"),
      health: z.string().describe("Health/body target for the week"),
    }),
    execute: async ({ revenue, personal, health }) => {
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1); // Monday
      const weekKey = weekStart.toISOString().slice(0, 10);

      const targets = { revenue, personal, health, setAt: new Date().toISOString() };

      await prisma.brainMemory.upsert({
        where: { category_key: { category: "weekly_target", key: `week_${weekKey}` } },
        create: {
          category: "weekly_target",
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
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
      const weekKey = weekStart.toISOString().slice(0, 10);

      const target = await prisma.brainMemory.findUnique({
        where: { category_key: { category: "weekly_target", key: `week_${weekKey}` } },
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
          where: { category_key: { category: "identity_snapshot", key: "current" } },
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
            where: { category_key: { category: "identity_snapshot", key: "current" } },
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
        prisma.task.findMany({ where: { status: { in: ["READY", "DOING"] }, deletedAt: null }, orderBy: { autoPriority: "desc" }, take: 5 }).catch((): never[] => []),
        prisma.driftAlert.findMany({ where: { resolved: false } }).catch((): never[] => []),
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
            where: { category_key: { category: "identity_snapshot", key: "current" } },
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
              category: "identity_snapshot",
              deletedAt: null,
              updatedAt: { gte: daysAgo(7) },
            },
            orderBy: { updatedAt: "desc" },
            select: { content: true, updatedAt: true },
          })
          .catch((): Array<{ content: string; updatedAt: Date }> => []),
        prisma.task.count({ where: { status: "DONE", updatedAt: { gte: daysAgo(7) } } }).catch(() => 0),
        prisma.task.count({ where: { createdAt: { gte: daysAgo(7) } } }).catch(() => 0),
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
          .catch((): Array<{ title: string; streakCount: number }> => []),
        prisma.driftAlert.findMany({ where: { date: { gte: sevenAgo } } }).catch((): never[] => []),
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
        } catch {
          // Skip malformed snapshot rows
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
        driftAlerts: { total: alerts.length, resolved: alerts.filter((a: { resolved: boolean }) => a.resolved).length },
      };
    },
  }),

  // ═══════════════════════════════════════════════════════════
  // WEEKLY TARGETS — Track 3 weekly goals (revenue, personal, health)
  // ═══════════════════════════════════════════════════════════

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
              category: "identity_snapshot",
              deletedAt: null,
              updatedAt: { gte: sevenDaysAgoDate },
            },
            orderBy: { updatedAt: "desc" },
            select: { content: true, updatedAt: true },
          })
          .catch((): Array<{ content: string; updatedAt: Date }> => []),
        prisma.task.count({ where: { status: "DONE", lastTouchedAt: { gte: sevenDaysAgoDate } } }),
        prisma.driftAlert.count({ where: { createdAt: { gte: sevenDaysAgoDate } } }),
        prisma.task
          .findMany({
            where: {
              loopKind: "DAILY",
              deletedAt: null,
              lastCompletedAt: { gte: sevenDaysAgoDate },
            },
            select: { title: true, streakCount: true },
          })
          .catch((): Array<{ title: string; streakCount: number }> => []),
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
        } catch {
          // Snapshot row not in JSON shape — skip.
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
