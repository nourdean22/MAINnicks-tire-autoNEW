/**
 * components/actions/derive-mission-matrix.ts · MissionScoreboard
 * derivation (task #15 · 2026-05-23).
 *
 * Pure derivation from (Project[], Task[]) → the props the
 * <ComparisonMatrix> needs. Lives next to <MissionScoreboard>
 * rather than in /lib because nothing else consumes it · co-locating
 * keeps the component file from drifting from its derivation logic.
 *
 * Mirror of `/system/providers/derive-provider-matrix.ts` (task #8/#9):
 * separation exists for ONE reason — testability. The component reads
 * data via tRPC hooks; the helper is plain data-in / data-out so a
 * unit test asserts column choices + scoring inversion without a
 * jsdom + React Query + tRPC provider tree.
 *
 * Column choices (locked):
 *   · progress · % done of mission's tasks · higher-is-better
 *   · velocity · tasks completed today · higher-is-better
 *   · overdue  · count of overdue open tasks · lower-is-better
 *   · stale    · days since latest activity · lower-is-better
 *   · deadline · days to deadline (or null/"—") · informational only
 *
 * Why these · they answer the operator question "which mission is
 * healthiest, which is at risk?" in one glance. Progress gives the
 * altitude · velocity gives the slope · overdue + stale give the
 * risk axes · deadline is informational (target, not a verdict on
 * the mission's current state).
 */

import type {
  MatrixCell,
  MatrixCriterion,
  MatrixOption,
} from "@/components/ui/comparison-matrix";
import type { Project, Task } from "@/components/actions/shared";

/**
 * Per-mission rollup. Computed once by `buildMissionMatrixOptions` ·
 * tunneled through `MissionMatrixOption._metrics` so the cell
 * resolver doesn't recompute on every render.
 */
export interface MissionMetrics {
  /** Mission id · stable key. */
  id: string;
  /** Mission title · already title-cased by the service. */
  title: string;
  /** Mission domain · "Inbox" if unassigned. */
  domain: string;
  /** 0-100 · null when the mission has no tasks at all. */
  progressPct: number | null;
  /** Tasks completed today (lastTouchedAt within last 24h + status DONE). */
  doneTodayCount: number;
  /** Count of open tasks with a past dueDate. */
  overdueCount: number;
  /**
   * Days since the latest lastTouchedAt across this mission's tasks ·
   * null when the mission has no tasks (different signal from "0 days"
   * which means activity TODAY).
   */
  daysIdle: number | null;
  /** Days until mission.deadline · null when no deadline set. */
  daysToDeadline: number | null;
  /** Total tasks (open + done) · informational, not a column. */
  totalTasks: number;
}

export const MISSION_MATRIX_CRITERIA: ReadonlyArray<MatrixCriterion> = [
  { id: "progress", label: "progress %", higherIsBetter: true },
  { id: "velocity", label: "done today", higherIsBetter: true },
  { id: "overdue", label: "overdue", higherIsBetter: false },
  { id: "stale", label: "days idle", higherIsBetter: false },
  { id: "deadline", label: "days to deadline" },
];

/**
 * Matrix option for a mission · ID is the mission id (stable). Extra
 * fields tunnel the rollup through so the cell resolver reads
 * everything from a single lookup.
 */
export interface MissionMatrixOption extends MatrixOption {
  _metrics: MissionMetrics;
}

/** ms → day count · floor toward 0 · negative = in the past. */
function daysBetween(later: Date, earlier: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / (24 * 60 * 60 * 1000));
}

/** Parse an ISO string or return null if absent/malformed. */
function safeDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * 2026-05-23 · task #22 · ADR-0017 amended Rule 6 · effort-weighted
 * progress rollup. Replaces the original `done / all` formula which
 * weighted every task equally · a parent with one easy DONE + one
 * hard OPEN would claim 50% complete which is silently wrong.
 *
 * Weights mirror the EFFORT_RANK ladder in loop-stream.tsx · M5 is
 * the smallest unit of work + H2PLUS is the heaviest. Unknown/
 * missing effort defaults to the middle weight (M30=3) so legacy
 * tasks without an effort estimate still contribute · they just
 * don't dominate the rollup.
 *
 *   parent.progressPct =
 *     sum(EFFORT_WEIGHT[child.effort] · child.isDone ? 1 : 0)
 *     / sum(EFFORT_WEIGHT[child.effort])
 *
 * Practical effect · finishing a heavy task moves the scoreboard
 * needle further than finishing a light one · matches the
 * operator's mental model of "how much work has been done".
 */
const EFFORT_WEIGHT: Record<string, number> = {
  M5: 1,
  M15: 2,
  M30: 3,
  H1: 4,
  H2PLUS: 5,
};
/** Default when effort is missing/unknown · middle weight · 3 (M30). */
const EFFORT_WEIGHT_DEFAULT = 3;
function weightOf(t: Task): number {
  if (!t.effort) return EFFORT_WEIGHT_DEFAULT;
  return EFFORT_WEIGHT[t.effort] ?? EFFORT_WEIGHT_DEFAULT;
}

/**
 * Build per-mission metrics from raw `(missions, tasks)`. Pure ·
 * `now` is injected so tests can freeze time without mocking Date.
 */
export function computeMissionMetrics(
  missions: ReadonlyArray<Project>,
  tasks: ReadonlyArray<Task>,
  now: Date = new Date(),
): MissionMetrics[] {
  // Group tasks by missionId once · O(N) bucketing.
  const tasksByMission = new Map<string, Task[]>();
  for (const t of tasks) {
    const arr = tasksByMission.get(t.missionId);
    if (arr) {
      arr.push(t);
    } else {
      tasksByMission.set(t.missionId, [t]);
    }
  }

  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  return missions.map((m) => {
    const mTasks = tasksByMission.get(m.id) ?? [];
    const totalTasks = mTasks.length;
    // 2026-05-23 · task #22 · ADR-0017 amended Rule 6 · effort-weighted
    // progress. The original `done / all` formula treated every task
    // as equally weighty · a parent with one easy DONE + one hard
    // OPEN claimed 50% complete which is silently wrong. Now the
    // numerator + denominator both scale with EFFORT_WEIGHT so a
    // heavy task moves the needle further than a light one.
    let weightedDone = 0;
    let weightedTotal = 0;
    for (const t of mTasks) {
      const w = weightOf(t);
      weightedTotal += w;
      if (t.status === "DONE") weightedDone += w;
    }
    const progressPct =
      weightedTotal === 0
        ? null
        : Math.round((weightedDone / weightedTotal) * 100);

    let doneTodayCount = 0;
    let overdueCount = 0;
    let latestActivity: Date | null = null;

    for (const t of mTasks) {
      const lastTouched = safeDate(t.lastTouchedAt) ?? safeDate(t.updatedAt);
      if (lastTouched && (!latestActivity || lastTouched > latestActivity)) {
        latestActivity = lastTouched;
      }
      // done today · status DONE + touched within last 24h
      if (t.status === "DONE" && lastTouched && lastTouched >= dayAgo) {
        doneTodayCount += 1;
      }
      // overdue · OPEN + past dueDate
      if (t.status !== "DONE" && t.status !== "CANCELLED") {
        const due = safeDate(t.dueDate);
        if (due && due < now) {
          overdueCount += 1;
        }
      }
    }

    const daysIdle = latestActivity ? daysBetween(now, latestActivity) : null;

    const deadline = safeDate(m.deadline);
    const daysToDeadline = deadline ? daysBetween(deadline, now) : null;

    return {
      id: m.id,
      title: m.title,
      domain: m.domain || "Inbox",
      progressPct,
      doneTodayCount,
      overdueCount,
      daysIdle,
      daysToDeadline,
      totalTasks,
    };
  });
}

/**
 * Adapt computed metrics to the matrix options shape. Filters out
 * missions with zero tasks because they have no signal to compare
 * (would show "—" across every column · noise).
 */
export function buildMissionMatrixOptions(
  missions: ReadonlyArray<Project>,
  tasks: ReadonlyArray<Task>,
  now: Date = new Date(),
): MissionMatrixOption[] {
  return computeMissionMetrics(missions, tasks, now)
    .filter((m) => m.totalTasks > 0)
    .map((m) => ({
      id: m.id,
      // Show title + domain underneath in one line · matches the
      // editorial-minimalist tone (no SHOUTING). Domain hint is helpful
      // when the operator has missions with similar titles in different
      // domains.
      label: `${m.title} · ${m.domain.toLowerCase()}`,
      _metrics: m,
    }));
}

/**
 * Resolve a single matrix cell from an option × criterion. Pure ·
 * encodes the column-to-metric mapping + the lower-is-better
 * inversion for risk columns.
 */
export function resolveMissionMatrixCell(
  option: MatrixOption,
  criterion: MatrixCriterion,
): MatrixCell {
  const o = option as MissionMatrixOption;
  const m = o._metrics;
  switch (criterion.id) {
    case "progress": {
      if (m.progressPct == null) return { value: null, display: "—" };
      return {
        value: m.progressPct,
        score: m.progressPct,
        display: `${m.progressPct}%`,
      };
    }
    case "velocity":
      return {
        value: m.doneTodayCount,
        score: m.doneTodayCount,
        display: m.doneTodayCount === 0 ? "0" : String(m.doneTodayCount),
      };
    case "overdue":
      return {
        value: m.overdueCount,
        score: m.overdueCount,
        display: m.overdueCount === 0 ? "0" : String(m.overdueCount),
      };
    case "stale": {
      if (m.daysIdle == null) return { value: null, display: "—" };
      return {
        value: m.daysIdle,
        score: m.daysIdle,
        display: m.daysIdle === 0 ? "today" : `${m.daysIdle}d`,
      };
    }
    case "deadline": {
      // No score · ComparisonMatrix will assign neutral tint across the
      // whole column. Informational dimension.
      if (m.daysToDeadline == null) return { value: null, display: "—" };
      const d = m.daysToDeadline;
      const display =
        d < 0
          ? `${Math.abs(d)}d past`
          : d === 0
            ? "today"
            : `${d}d`;
      return { value: d, display };
    }
    default:
      return { value: null };
  }
}
