"use client";

/**
 * useTaskReviewActions — shared decisive-action handlers for the NOW
 * mode review surfaces.
 *
 * Apr 26 · The stale-chip three buttons (F3) and the headline review
 * sheet (F1) both need exactly these three verbs:
 *   · kill     — archive + emit `killed` event for avoidance learning
 *   · reframe  — flip into edit mode with cursor in the action field
 *   · blocker  — capture a `waitingOn` value and flip status → WAITING
 *
 * Each verb fires the underlying mutation, emits a TaskEvent (which
 * is the substrate the avoidance/skip-pattern detectors will read),
 * notifies the data-change bus so other surfaces refresh, and shows
 * a tiny toast confirming the action.
 *
 * Returns granular fns so callers compose them as buttons in their
 * own layout.
 */

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { notifyDataChanged } from "@/lib/events/data-change";

import { authedFetch } from "@/hooks/use-authed-fetch";
interface UseTaskReviewActionsOpts {
  /** Caller's reload — runs after every successful action. */
  onChange?: () => void | Promise<void>;
  /** UI surface that triggered this — passed to TaskEvent.source. */
  source?: string;
}

interface ReviewActions {
  kill: (taskId: string) => Promise<void>;
  reframe: (taskId: string, opts: { title?: string; nextPhysicalAction?: string }) => Promise<void>;
  blocker: (taskId: string, waitingOn: string) => Promise<void>;
  /** Apr 26 · F4 — push the dueDate forward by N days. The
   *  underlying updateTask diffs and emits TaskEvent.snoozed when
   *  the new date is later than the existing one. */
  snooze: (taskId: string, days: number) => Promise<void>;
  /** Apr 26 · F1 — generic field edit. Patch any subset of editable
   *  task fields. Wraps the same PATCH endpoint as reframe but
   *  doesn't constrain the schema. */
  edit: (taskId: string, patch: Record<string, unknown>) => Promise<void>;
  /** Most recent in-flight task id — for inline spinner state. */
  busyId: string | null;
}

export function useTaskReviewActions(opts: UseTaskReviewActionsOpts = {}): ReviewActions {
  const { onChange, source = "page:tasks/now" } = opts;
  const [busyId, setBusyId] = useState<string | null>(null);

  const fireRefresh = useCallback(() => {
    notifyDataChanged("tasks", { source, detail: "review-action" });
    void onChange?.();
  }, [onChange, source]);

  const kill = useCallback(
    async (taskId: string) => {
      setBusyId(taskId);
      try {
        const res = await authedFetch(`/api/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "ARCHIVED" }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // The TaskEvent emit happens inside updateTask, but it'll be
        // flagged "abandoned" — we want this surface to record an
        // explicit "killed" decision so avoidance signals are clean.
        // Fire a separate explicit event via the dedicated endpoint.
        void authedFetch(`/api/tasks/${taskId}/event`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "killed", source }),
        }).catch(() => {});
        toast.success("Killed.");
        fireRefresh();
      } catch (err) {
        toast.error(`Couldn't kill: ${err instanceof Error ? err.message : "unknown"}`);
      } finally {
        setBusyId(null);
      }
    },
    [fireRefresh, source],
  );

  const reframe = useCallback(
    async (
      taskId: string,
      patch: { title?: string; nextPhysicalAction?: string },
    ) => {
      setBusyId(taskId);
      try {
        const res = await authedFetch(`/api/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        toast.success("Reframed.");
        fireRefresh();
      } catch (err) {
        toast.error(`Couldn't reframe: ${err instanceof Error ? err.message : "unknown"}`);
      } finally {
        setBusyId(null);
      }
    },
    [fireRefresh],
  );

  const blocker = useCallback(
    async (taskId: string, waitingOn: string) => {
      setBusyId(taskId);
      try {
        const res = await authedFetch(`/api/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "WAITING", waitingOn }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        toast.success(`Waiting on ${waitingOn}.`);
        fireRefresh();
      } catch (err) {
        toast.error(`Couldn't update: ${err instanceof Error ? err.message : "unknown"}`);
      } finally {
        setBusyId(null);
      }
    },
    [fireRefresh],
  );

  const snooze = useCallback(
    async (taskId: string, days: number) => {
      setBusyId(taskId);
      try {
        const next = new Date();
        next.setDate(next.getDate() + days);
        next.setHours(7, 0, 0, 0); // resurface at 7am local on the snooze day
        // v10.0.529.82 · Wave 26 · B1 · snooze now actually snoozes.
        //   Pre-Wave-26 snooze just pushed dueDate · the task stayed
        //   in READY/INBOX, still counted against the open list, and
        //   never visibly went away.
        //   Post-Wave-26 status flips WAITING + snoozedUntil set ·
        //   task disappears from active list · task-resurface cron
        //   flips back to READY when the timestamp passes (folded
        //   into mega-morning).
        const res = await authedFetch(`/api/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: "WAITING",
            snoozedUntil: next.toISOString(),
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const label = days === 1 ? "tomorrow" : days === 7 ? "next week" : `${days}d`;
        toast.success(`snoozed · back ${label}`);
        fireRefresh();
      } catch (err) {
        toast.error(`couldn't snooze: ${err instanceof Error ? err.message : "unknown"}`);
      } finally {
        setBusyId(null);
      }
    },
    [fireRefresh],
  );

  const edit = useCallback(
    async (taskId: string, patch: Record<string, unknown>) => {
      setBusyId(taskId);
      try {
        const res = await authedFetch(`/api/tasks/${taskId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        toast.success("Saved.");
        // Apr 27 · domain-aware notify — "edit anywhere = update
        // everywhere." When the patch touches a relational field
        // (goalId, missionId), fire the matching domain so the goal
        // breadcrumb on NOW + the project step list on PLAN both
        // refresh, not just the task list.
        notifyDataChanged("tasks", { source, detail: "edit", id: taskId });
        if ("goalId" in patch) {
          notifyDataChanged("goals", { source, detail: "edit", id: taskId });
        }
        if ("missionId" in patch) {
          notifyDataChanged("projects", { source, detail: "edit", id: taskId });
        }
        void onChange?.();
      } catch (err) {
        toast.error(`Couldn't save: ${err instanceof Error ? err.message : "unknown"}`);
      } finally {
        setBusyId(null);
      }
    },
    [onChange, source],
  );

  return { kill, reframe, blocker, snooze, edit, busyId };
}
