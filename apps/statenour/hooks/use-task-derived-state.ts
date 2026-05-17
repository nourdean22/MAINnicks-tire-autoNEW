"use client";

/**
 * useTaskDerivedState · v10.0.529.18
 *
 * Materializes every page-level derivation off `tasks` for /tasks.
 * Pre-extraction these lived inline in page.tsx — most were unmemoized
 * filter()/count chains that re-walked the task list on EVERY parent
 * render (filter ticks · drift state · edit-sheet toggles). Lifting
 * them here gives each one a useMemo with the right minimal slice +
 * makes the page body skim-readable.
 *
 * Inputs · `tasks` (the full Task[] feed from /api/tasks).
 *
 * Outputs ·
 *   active        — INBOX | READY | DOING rows. Drives LoopStream.
 *   waiting       — WAITING rows. Drives WaitingBand.
 *   done          — DONE rows. Drives DoneDrawer + doneSpark.
 *   reviewSet     — overdue OR stale subset of active, excluding
 *                   DAILY + already-blocked. Sorted oldest-touch first.
 *                   Drives the smart-headline REVIEW chip + wizard.
 *   doing         — count of active rows with status DOING.
 *   doneToday     — count of done rows updated today (ds=0).
 *   overdue       — count of active rows past dueDate or stale > 7d.
 *   dailyCount    — count of active rows with loopKind DAILY.
 *   promiseCount  — count of active rows with loopKind PROMISE.
 *   onceCount     — count of active rows with loopKind ONCE (or null).
 *
 * Memoization keys ·
 *   Each derived value depends only on `tasks` (or a subset already
 *   derived from `tasks`). React's useMemo dependency on `tasks`
 *   re-runs all of these together when the array reference changes —
 *   which is correct: tasks are refetched as a single Promise.all,
 *   so they tick atomically. Sub-memos on `active` keep the cost
 *   of the reviewSet sort + counts proportional to active size,
 *   not total tasks.
 */

import { useMemo } from "react";
import { daysSince as ds, type Task } from "@/components/actions/shared";

export interface TaskDerivedState {
  active: Task[];
  waiting: Task[];
  done: Task[];
  reviewSet: Task[];
  doing: number;
  doneToday: number;
  overdue: number;
  dailyCount: number;
  promiseCount: number;
  onceCount: number;
}

export function useTaskDerivedState(tasks: Task[]): TaskDerivedState {
  // Three primary partitions of the task feed by status. We keep them
  // as separate memos (vs. one big object) so consumers of `active`
  // don't tick when only `done` changes.
  const active = useMemo(
    () => tasks.filter((t) => ["INBOX", "READY", "DOING"].includes(t.status)),
    [tasks],
  );
  const waiting = useMemo(
    () => tasks.filter((t) => t.status === "WAITING"),
    [tasks],
  );
  const done = useMemo(
    () => tasks.filter((t) => t.status === "DONE"),
    [tasks],
  );

  // Counts off active. Each is O(n) over a slice that's typically
  // <20 rows in normal operator load.
  const doing = useMemo(
    () => active.filter((t) => t.status === "DOING").length,
    [active],
  );
  const doneToday = useMemo(
    () =>
      done.filter((t) => ds(t.updatedAt || t.lastTouchedAt) === 0).length,
    [done],
  );
  const overdue = useMemo(
    () =>
      active.filter((t) => {
        if (t.loopKind === "DAILY") return false;
        if (t.dueDate) return new Date(t.dueDate).getTime() < Date.now();
        return !!t.stale || ds(t.createdAt) > 7;
      }).length,
    [active],
  );

  const dailyCount = useMemo(
    () => active.filter((t) => t.loopKind === "DAILY").length,
    [active],
  );
  const promiseCount = useMemo(
    () => active.filter((t) => t.loopKind === "PROMISE").length,
    [active],
  );
  const onceCount = useMemo(
    () =>
      active.filter((t) => !t.loopKind || t.loopKind === "ONCE").length,
    [active],
  );

  // Review-eligible · overdue OR stale, excluding DAILY (own rhythm)
  // and already-blocked rows. Sorted oldest-touch first so the most
  // decision-critical row surfaces at the top of the wizard.
  const reviewSet = useMemo(
    () =>
      active
        .filter((t) => {
          if (t.loopKind === "DAILY") return false;
          if (t.waitingOn) return false;
          const isOverdue =
            t.dueDate && new Date(t.dueDate).getTime() < Date.now();
          const isStale = !!t.stale || ds(t.lastTouchedAt || t.updatedAt) >= 7;
          return isOverdue || isStale;
        })
        .sort((a, b) => {
          const aLast = ds(a.lastTouchedAt || a.updatedAt) ?? 0;
          const bLast = ds(b.lastTouchedAt || b.updatedAt) ?? 0;
          return bLast - aLast;
        }),
    [active],
  );

  return {
    active,
    waiting,
    done,
    reviewSet,
    doing,
    doneToday,
    overdue,
    dailyCount,
    promiseCount,
    onceCount,
  };
}
