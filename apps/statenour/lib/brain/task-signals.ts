/**
 * Task Signals — single aggregator that returns "everything the live
 * scorer + UI need to know about right now."
 *
 * Apr 26 · The substrate for the NOW-mode upgrades. Today the task
 * page reads its own data, scores tasks with a flat formula, and
 * never adapts to time-of-day, energy state, or what's happening
 * elsewhere in the system. This module collects the live signals
 * once per request and hands them as a single bag to consumers.
 *
 * Pure-ish: it does DB reads, but all aggregation is in-memory.
 * Failures are tolerated — every field has a sensible default so
 * the page never crashes on a slow upstream.
 *
 * Cost: ~3-5 small queries in parallel, total ~80-150ms warm.
 *
 * Used by:
 *   · /api/tasks (server-side ranking)
 *   · /api/now/signals (UI freshness probe — feature F2)
 *   · loop-stream component (live row coloring — feature F6)
 */

import { prisma } from "@/lib/prisma";
import { safeQuery } from "@/lib/db/safe-prisma";
import { getDoneTodayCount } from "@/lib/brain/task-events";
import { getLatestGovernorDecision } from "@/lib/health-governor/health-governor-guardrails";

/** Coarse energy/state bucket aligned with NourState's currentState. */
export type LiveState = "peak" | "normal" | "low" | "drift" | "recovery";

export interface TaskSignals {
  /** Local hour 0-23 — consumers use this for time-of-day fits. */
  hour: number;
  /** Local day of week 0=Sun..6=Sat. */
  dayOfWeek: number;
  /** Live state from DailyExecutionState; falls back to "normal". */
  state: LiveState;
  /** Number of tasks completed today (from TaskEvent). */
  doneToday: number;
  /** Number of tasks marked READY but not DOING/DONE. */
  openCount: number;
  /** Number of tasks past dueDate, status not DONE/ARCHIVED. */
  lateCount: number;
  /** Stale (>= 14d untouched, status READY) count. */
  staleCount: number;
  /** "Realistic" capacity remaining today in minutes. Derived from a
   *  rolling 30-day completion rate vs estimated effort. */
  capacityRemainingMin: number;
  /** Total minutes currently allocated across READY+DOING tasks. */
  allocatedMin: number;
  /** ISO timestamp the bag was assembled — for cache-staleness checks. */
  generatedAt: string;
}

/** Minutes per EffortBand — same mapping the priority scorer uses. */
const EFFORT_MINUTES: Record<string, number> = {
  M5: 5,
  M15: 15,
  M30: 30,
  H1: 60,
  H2: 120,
  H4: 240,
  H8: 480,
};

/**
 * Coarse "how much can I realistically do in the rest of today"
 * estimate. Looks at the last 30 days of completion events to figure
 * out Nour's actual throughput per active hour, then projects across
 * remaining waking hours.
 *
 * Default assumption: 4h focused capacity per day. Overridden by
 * historical data once available.
 */
async function estimateCapacityRemainingMin(): Promise<number> {
  try {
    const since = new Date(Date.now() - 30 * 86400_000);
    const completed = await prisma.taskEvent.count({
      where: { kind: "completed", createdAt: { gte: since } },
    });
    // 30 days × ~4h focused = 120 expected tasks (~30min each).
    // If completed ratio < 1.0, scale capacity down accordingly.
    const ratio = Math.max(0.3, Math.min(1.0, completed / 60));
    const baseCapacityMin = 240; // 4h
    const fullDayCapacity = Math.round(baseCapacityMin * ratio);
    // Project remaining waking hours. Roughly: 8am → 11pm = 15h.
    const now = new Date();
    const hour = now.getHours();
    const remainingFraction = Math.max(0, Math.min(1, (23 - hour) / 15));
    return Math.round(fullDayCapacity * remainingFraction);
  } catch {
    return 240;
  }
}

async function readLiveState(): Promise<LiveState> {
  try {
    const decision = await getLatestGovernorDecision();
    if (decision) {
      const modeMap: Record<string, LiveState> = {
        OPTIMIZED: "peak",
        STABLE: "normal",
        RECOVERY_LOCK: "recovery",
        SHADOW_MODE: "drift",
        LOCKDOWN: "low",
      };
      return modeMap[decision.mode] ?? "normal";
    }

    // Fallback to legacy DailyExecutionState if governor decision is null
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const row = await prisma.dailyExecutionState.findUnique({
      where: { stateDate: today },
      select: { dayState: true },
    });
    if (!row?.dayState) return "normal";
    const map: Record<string, LiveState> = {
      OPEN: "normal",
      LOCKED_IN: "peak",
      DRIFT: "drift",
      RECOVERY: "recovery",
      LOW: "low",
    };
    return map[row.dayState] ?? "normal";
  } catch {
    return "normal";
  }
}

interface TaskAggregate {
  status: string;
  effort: string | null;
  dueDate: Date | null;
  lastTouchedAt: Date | null;
}

function aggregate(tasks: TaskAggregate[]) {
  const now = Date.now();
  let openCount = 0;
  let lateCount = 0;
  let staleCount = 0;
  let allocatedMin = 0;
  for (const t of tasks) {
    const isOpen = t.status === "READY" || t.status === "INBOX" || t.status === "DOING";
    if (isOpen) {
      openCount++;
      const min = EFFORT_MINUTES[t.effort ?? "M30"] ?? 30;
      allocatedMin += min;
      if (t.dueDate && t.dueDate.getTime() < now) lateCount++;
      if (t.status === "READY") {
        const last = t.lastTouchedAt?.getTime() ?? 0;
        if (last && now - last > 14 * 86400_000) staleCount++;
      }
    }
  }
  return { openCount, lateCount, staleCount, allocatedMin };
}

/**
 * Top-level entry — assemble the full signal bag in one call. Safe
 * to call from any server context; never throws.
 */
export async function gatherTaskSignals(): Promise<TaskSignals> {
  const now = new Date();

  const [tasks, doneToday, state, capacityMin] = await Promise.all([
    safeQuery(
      () =>
        prisma.task.findMany({
          where: { status: { notIn: ["DONE", "ARCHIVED"] }, deletedAt: null },
          select: {
            status: true,
            effort: true,
            dueDate: true,
            lastTouchedAt: true,
          },
        }),
      [] as TaskAggregate[],
      { label: "task-signals.tasks" },
    ),
    safeQuery(() => getDoneTodayCount(), 0, { label: "task-signals.done-today" }),
    safeQuery(() => readLiveState(), "normal" as LiveState, {
      label: "task-signals.live-state",
    }),
    safeQuery(() => estimateCapacityRemainingMin(), 240, {
      label: "task-signals.capacity",
    }),
  ]);

  const agg = aggregate(tasks as TaskAggregate[]);

  return {
    hour: now.getHours(),
    dayOfWeek: now.getDay(),
    state,
    doneToday,
    openCount: agg.openCount,
    lateCount: agg.lateCount,
    staleCount: agg.staleCount,
    capacityRemainingMin: capacityMin,
    allocatedMin: agg.allocatedMin,
    generatedAt: now.toISOString(),
  };
}

/**
 * Per-task fit checks — pure function that any consumer can call
 * with `(task, signals)` to get a coloring hint without re-doing
 * the math.
 */
export type FitVerdict =
  | "fits-now"     // energy match + within remaining capacity
  | "save-morning" // HIGH energy task, current state low
  | "wrong-moment" // active conflict, e.g. drift state + complex task
  | "neutral";

export function classifyFit(
  energyRequired: string,
  effort: string,
  signals: TaskSignals,
): FitVerdict {
  const min = EFFORT_MINUTES[effort] ?? 30;
  const overCapacity = min > signals.capacityRemainingMin;
  if (signals.state === "drift" && (effort === "H2" || effort === "H4" || effort === "H8")) {
    return "wrong-moment";
  }
  if (energyRequired === "HIGH" && (signals.state === "low" || signals.state === "recovery")) {
    return "save-morning";
  }
  if (overCapacity) return "save-morning";
  if (energyRequired === "LOW" || signals.state === "peak") return "fits-now";
  return "neutral";
}
