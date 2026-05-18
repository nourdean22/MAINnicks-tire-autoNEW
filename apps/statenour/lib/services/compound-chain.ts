/**
 * lib/services/compound-chain.ts · Phase G (2026-05-18 PM)
 *
 * The CompoundChain composer · the "see your work compound" engine.
 *
 * Most operator UIs show CURRENT state per surface (tasks · goals · stats)
 * but never show the CHAIN that connects them. When you check off a
 * task that's tagged with a goalId, the system:
 *
 *   task.complete → goal.currentValue +1 → mastery.score +δ → scoreboard.delta
 *
 * That chain is invisible in the UI. This composer reconstructs it so
 * the operator SEES their work compound — read as a narrative, not a
 * dashboard.
 *
 * Surface variants:
 *   · tasks      · TODAY's forward chain · "you did X, it lifted Y"
 *   · goals      · this WEEK per goal · "these tasks moved you 7→9 / 12"
 *   · scoreboard · this number's chain · "what compounded into 7.4 · ↑0.3"
 *   · home       · headline counts only · "today · N tasks · N goals · N axes"
 *
 * Implementation:
 *   · Pure Prisma reads · no AI · sub-300ms typical
 *   · Reuses goals-snapshot + meta-scoreboard for the static axis/anchor
 *     lookups · no duplicated queries
 *   · Returns a TREE structure grouped by axis · narrative renderer
 *     iterates and joins
 *
 * See: /api/operator/compound · components/operator/compound-chain.tsx
 */

import { prisma } from "@/lib/prisma";
import { buildGoalsSnapshot, type AxisScore } from "./goals-snapshot";
import { buildMetaScoreboard, type ScoreboardNumber } from "./meta-scoreboard";
import { today as todayET } from "@/lib/utils/datetime";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("services/compound-chain");

export type CompoundSurface = "tasks" | "goals" | "scoreboard" | "home";

// ── Public shapes ──────────────────────────────────────────────────

export interface TaskSegment {
  id: string;
  title: string;
  completedAt: string;
  /** Effort in minutes (actual or estimate) */
  effort: number | null;
}

export interface GoalSegment {
  id: string;
  title: string;
  domain: string;
  /** Progress at the moment we composed (0-100) */
  progress: number;
  /** Tasks that lifted this goal in the window */
  tasks: TaskSegment[];
}

export interface AxisChain {
  domain: string;
  /** Current axis score (0-10) */
  score: number | null;
  /** 7d delta · positive = improving */
  delta7d: number | null;
  /** Scoreboard number that surfaces this axis (if any) */
  scoreboard: {
    label: string;
    display: string;
    href: string | null;
  } | null;
  /** Goals in this axis that got moved in the window */
  goals: GoalSegment[];
}

export interface ChainStats {
  /** Window label (e.g. "today", "this week") */
  window: string;
  totalTasks: number;
  totalGoalsLifted: number;
  totalAxesMoved: number;
  totalScoreboardShifts: number;
}

/** Phase G.2 · forward-looking · "if you complete these, here's what
 *  compounds" · open task with a goalId, grouped by axis. Lets the
 *  operator see the leverage stack they haven't activated yet. */
export interface PotentialChain {
  /** Same shape as AxisChain but the task list is OPEN, not DONE */
  domain: string;
  score: number | null;
  delta7d: number | null;
  scoreboard: { label: string; display: string; href: string | null } | null;
  goals: GoalSegment[];
}

export interface CompoundChainSnapshot {
  surface: CompoundSurface;
  stats: ChainStats;
  /** Backward-looking chains · "this is what compounded in {window}" */
  axes: AxisChain[];
  /** Phase G.2 · forward-looking · "if you complete these open tasks,
   *  this is what would compound". Top 8 open tasks with goalId,
   *  grouped by axis. */
  potential: PotentialChain[];
  /** Phase G.2 · orphan signal · count of DONE tasks in the window
   *  that have no goalId (uncaptured compound leverage). Component
   *  surfaces a small "N tasks done without a goal link" nudge. */
  orphanDoneCount: number;
  /** When this was composed (UTC ISO) */
  composedAt: string;
}

// ── Composer ───────────────────────────────────────────────────────

function windowForSurface(surface: CompoundSurface): {
  start: Date;
  end: Date;
  label: string;
} {
  const now = Date.now();
  if (surface === "tasks") {
    const date = todayET();
    return {
      start: new Date(`${date}T00:00:00.000-04:00`),
      end: new Date(`${date}T23:59:59.999-04:00`),
      label: "today",
    };
  }
  if (surface === "goals") {
    return {
      start: new Date(now - 7 * 86_400_000),
      end: new Date(now),
      label: "this week",
    };
  }
  if (surface === "scoreboard") {
    return {
      start: new Date(now - 7 * 86_400_000),
      end: new Date(now),
      label: "this week",
    };
  }
  // home · default to today (matches operator's mental model)
  const date = todayET();
  return {
    start: new Date(`${date}T00:00:00.000-04:00`),
    end: new Date(`${date}T23:59:59.999-04:00`),
    label: "today",
  };
}

function findAxisForDomain(
  domain: string,
  axes: AxisScore[],
): AxisScore | null {
  // Domain string match · normalize both sides for safety
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const target = norm(domain);
  return axes.find((a) => norm(a.domain) === target) ?? null;
}

/** Convert an EffortBand enum value to a sane default minute count. */
function effortBandToMinutes(band: string | null | undefined): number | null {
  if (!band) return null;
  switch (band) {
    case "S5":
      return 5;
    case "M15":
      return 15;
    case "M30":
      return 30;
    case "H1":
      return 60;
    case "H2":
      return 120;
    case "H4":
      return 240;
    default:
      return null;
  }
}

/** Phase G.2 helper · fetch DONE tasks with goalId in a window.
 *  Pulled out so the buildCompoundChain composer can call it once for
 *  the primary window and again for the fallback widen-passes. */
async function fetchDoneTasksWithGoalIn(start: Date, end: Date) {
  return prisma.task
    .findMany({
      where: {
        status: "DONE",
        updatedAt: { gte: start, lte: end },
        deletedAt: null,
        goalId: { not: null },
      },
      select: {
        id: true,
        title: true,
        updatedAt: true,
        actualMinutes: true,
        effort: true,
        goalId: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 60,
    })
    .catch((err) => {
      log.warn("done_tasks_failed", {
        err: err instanceof Error ? err.message.slice(0, 200) : String(err),
      });
      return [];
    });
}

function findScoreboardForAxis(
  domain: string,
  numbers: ScoreboardNumber[],
): ScoreboardNumber | null {
  const norm = (s: string) => s.toLowerCase();
  // Mastery numbers are keyed as `mastery_<domain>` (see meta-scoreboard.ts
  // pickMasteryTopMover) · also try label match for resilience.
  const key = `mastery_${norm(domain)}`;
  return (
    numbers.find((n) => n.key === key) ??
    numbers.find((n) => norm(n.label).includes(norm(domain))) ??
    null
  );
}

export async function buildCompoundChain(
  surface: CompoundSurface,
): Promise<CompoundChainSnapshot> {
  let { start, end, label } = windowForSurface(surface);

  // Phase G.2 · window fallback · if the primary window has zero
  // chained completions, widen so the chain rarely looks dead. Order:
  // today → this week → last 30 days. Operator on a quiet day still
  // sees the most-recent compound trail instead of a blank pane.
  let doneTasks = await fetchDoneTasksWithGoalIn(start, end);
  if (doneTasks.length === 0 && label === "today") {
    const widerStart = new Date(Date.now() - 7 * 86_400_000);
    const widerTasks = await fetchDoneTasksWithGoalIn(widerStart, end);
    if (widerTasks.length > 0) {
      doneTasks = widerTasks;
      start = widerStart;
      label = "this week";
    }
  }
  if (doneTasks.length === 0) {
    const widestStart = new Date(Date.now() - 30 * 86_400_000);
    const widestTasks = await fetchDoneTasksWithGoalIn(widestStart, end);
    if (widestTasks.length > 0) {
      doneTasks = widestTasks;
      start = widestStart;
      label = "last 30 days";
    }
  }

  const [goalsSnap, scoreboardSnap, openTasks, orphanDoneCount] = await Promise.all([
    buildGoalsSnapshot(),
    buildMetaScoreboard(),
    // Phase G.2 · potential chain · open tasks WITH a goalId · these
    // would compound if completed. Sorted by ROI so the highest-
    // leverage potential surfaces first.
    prisma.task
      .findMany({
        where: {
          status: { in: ["INBOX", "READY", "DOING"] },
          deletedAt: null,
          goalId: { not: null },
        },
        select: {
          id: true,
          title: true,
          updatedAt: true,
          actualMinutes: true,
          effort: true,
          goalId: true,
        },
        orderBy: [{ roiScore: "desc" }, { updatedAt: "desc" }],
        take: 8,
      })
      .catch(() => []),
    // Phase G.2 · orphan count · DONE in primary window WITHOUT goalId.
    // Count only · the nudge is "tag these so they compound". Uses the
    // *original* "today" window for the count even after fallback so
    // the operator gets a today-specific signal regardless of how wide
    // the chain composer's window stretched.
    prisma.task
      .count({
        where: {
          status: "DONE",
          updatedAt: { gte: windowForSurface(surface).start, lte: windowForSurface(surface).end },
          deletedAt: null,
          goalId: null,
        },
      })
      .catch(() => 0),
  ]).catch((err) => {
    log.warn("snapshot_failed", {
      err: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    throw err;
  });

  // Index goals by id for O(1) lookup
  const goalsById = new Map<
    string,
    { id: string; title: string; domain: string; progress: number }
  >();
  for (const h of [
    "DAY",
    "WEEK",
    "MONTH",
    "QUARTER",
    "YEAR",
    "LIFE",
    "UNSCOPED",
  ] as const) {
    for (const g of goalsSnap.ladder[h] ?? []) {
      goalsById.set(g.id, {
        id: g.id,
        title: g.title,
        domain: g.domain,
        progress: g.progress,
      });
    }
  }

  // Group tasks → goals → axes
  const axisMap = new Map<string, AxisChain>();

  for (const t of doneTasks) {
    if (!t.goalId) continue;
    const goal = goalsById.get(t.goalId);
    if (!goal) continue;

    const taskSeg: TaskSegment = {
      id: t.id,
      title: t.title,
      completedAt: t.updatedAt.toISOString(),
      // Prefer actual minutes when present (operator actually timed it via
      // startedAt → completion). Fall back to estimating from the effort
      // band (S5=5min, M15=15, M30=30, H1=60, H2=120, H4=240) so the chain
      // still shows a time signal for tasks where actualMinutes was 0.
      effort: t.actualMinutes && t.actualMinutes > 0
        ? t.actualMinutes
        : effortBandToMinutes(t.effort),
    };

    let axis = axisMap.get(goal.domain);
    if (!axis) {
      const axisScore = findAxisForDomain(goal.domain, goalsSnap.axes);
      const scoreboard = findScoreboardForAxis(
        goal.domain,
        scoreboardSnap.numbers,
      );
      axis = {
        domain: goal.domain,
        score: axisScore?.score ?? null,
        delta7d: axisScore?.delta7d ?? null,
        scoreboard: scoreboard
          ? {
              label: scoreboard.label,
              display: scoreboard.display,
              href: scoreboard.link,
            }
          : null,
        goals: [],
      };
      axisMap.set(goal.domain, axis);
    }

    let goalSeg = axis.goals.find((g) => g.id === goal.id);
    if (!goalSeg) {
      goalSeg = {
        id: goal.id,
        title: goal.title,
        domain: goal.domain,
        progress: goal.progress,
        tasks: [],
      };
      axis.goals.push(goalSeg);
    }
    goalSeg.tasks.push(taskSeg);
  }

  // Sort: axes by total task count desc · then by absolute delta desc.
  // Goals within axis by task count desc.
  // L.3 · toSorted (ES2023) · non-mutating · clearer intent than
  // in-place .sort on accumulator arrays.
  const axesArray = Array.from(axisMap.values()).map((a) => ({
    ...a,
    goals: a.goals.toSorted((g1, g2) => g2.tasks.length - g1.tasks.length),
  })).toSorted((a, b) => {
    const aTasks = a.goals.reduce((s, g) => s + g.tasks.length, 0);
    const bTasks = b.goals.reduce((s, g) => s + g.tasks.length, 0);
    if (bTasks !== aTasks) return bTasks - aTasks;
    return Math.abs(b.delta7d ?? 0) - Math.abs(a.delta7d ?? 0);
  });

  const totalTasks = axesArray.reduce(
    (s, a) => s + a.goals.reduce((g, g2) => g + g2.tasks.length, 0),
    0,
  );
  const totalGoals = axesArray.reduce((s, a) => s + a.goals.length, 0);
  const totalAxesMoved = axesArray.filter((a) => Math.abs(a.delta7d ?? 0) > 0)
    .length;
  const totalScoreboardShifts = axesArray.filter(
    (a) => a.scoreboard !== null && Math.abs(a.delta7d ?? 0) > 0,
  ).length;

  // Phase G.2 · compose the potential (forward) chain from open tasks.
  // Same grouping logic as backward chain · the tasks list is OPEN
  // tasks instead of DONE. Renders as "if you complete these, here's
  // what would compound."
  const potentialMap = new Map<string, PotentialChain>();
  for (const t of openTasks) {
    if (!t.goalId) continue;
    const goal = goalsById.get(t.goalId);
    if (!goal) continue;
    const taskSeg: TaskSegment = {
      id: t.id,
      title: t.title,
      completedAt: t.updatedAt.toISOString(),
      effort:
        t.actualMinutes && t.actualMinutes > 0
          ? t.actualMinutes
          : effortBandToMinutes(t.effort),
    };
    let entry = potentialMap.get(goal.domain);
    if (!entry) {
      const axisScore = findAxisForDomain(goal.domain, goalsSnap.axes);
      const scoreboard = findScoreboardForAxis(goal.domain, scoreboardSnap.numbers);
      entry = {
        domain: goal.domain,
        score: axisScore?.score ?? null,
        delta7d: axisScore?.delta7d ?? null,
        scoreboard: scoreboard
          ? { label: scoreboard.label, display: scoreboard.display, href: scoreboard.link }
          : null,
        goals: [],
      };
      potentialMap.set(goal.domain, entry);
    }
    let goalSeg = entry.goals.find((g) => g.id === goal.id);
    if (!goalSeg) {
      goalSeg = {
        id: goal.id,
        title: goal.title,
        domain: goal.domain,
        progress: goal.progress,
        tasks: [],
      };
      entry.goals.push(goalSeg);
    }
    goalSeg.tasks.push(taskSeg);
  }
  // L.3 · toSorted (ES2023)
  const potentialArray = Array.from(potentialMap.values()).map((p) => ({
    ...p,
    goals: p.goals.toSorted((a, b) => b.tasks.length - a.tasks.length),
  })).toSorted((a, b) => {
    const aTasks = a.goals.reduce((s, g) => s + g.tasks.length, 0);
    const bTasks = b.goals.reduce((s, g) => s + g.tasks.length, 0);
    return bTasks - aTasks;
  });

  return {
    surface,
    stats: {
      window: label,
      totalTasks,
      totalGoalsLifted: totalGoals,
      totalAxesMoved,
      totalScoreboardShifts,
    },
    axes: axesArray,
    potential: potentialArray,
    orphanDoneCount,
    composedAt: new Date().toISOString(),
  };
}

export const __internals = {
  windowForSurface,
  findAxisForDomain,
  findScoreboardForAxis,
};
