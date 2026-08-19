"use client";

/**
 * LoopStream — the Ferrari of todo lists.
 *
 * One unified smart-sorted list that replaces the old 4-section
 * stack (habits grid + commitments list + open loops + task lanes).
 * Everything Nour tracks is a Loop — ONCE, DAILY, or PROMISE — and
 * they all flow through this component.
 *
 * Visual hierarchy:
 *
 *   1. NEXT MOVE hero card — the single smartest thing to do right
 *      now, auto-picked by the urgency score.
 *   2. The stream — all active loops, smart-sorted by urgency,
 *      rendered as a single tight list. Each row shows the kind
 *      icon, title, and the most relevant metadata (streak flame,
 *      days-until-deadline, domain, effort).
 *   3. Done today chip — a compact "3 done · 2 kept · 1 broken"
 *      strip at the bottom.
 *
 * Urgency score ranking (higher = shown first):
 *
 *   +200  PROMISE overdue
 *   +150  DAILY not done today
 *   +100  ONCE critical (stale > 7d OR autoPriority >= 80)
 *   +80   DOING
 *   +70   PROMISE due today
 *   +60   PROMISE due within 3 days
 *   +50   ONCE high (autoPriority >= 60)
 *   +30   PROMISE due within 7 days
 *   +20   ONCE normal
 *   +10   ONCE low
 *
 * Completion uses /api/tasks/[id]/check which handles the kind-
 * specific logic (DAILY bumps streak + lastCompletedAt, PROMISE/
 * ONCE set status = DONE).
 *
 * v10.0.529.14 · row-body extracted to LoopRowItem (memoized child)
 * — see components/actions/loop-row-item.tsx. The parent now owns
 * shared state and stable callbacks; each row only re-renders when
 * one of ITS values flips, not on every parent state tick. Audit
 * win #1 from the /tasks code-explorer pass.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCustomDomains } from "@/hooks/use-custom-domains";
import { BreakPromiseModal } from "@/components/actions/break-promise-modal";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  Circle,
  Target,
  Clock,
  Pin,
  Zap,
  Loader2,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { notifyDataChanged } from "@/lib/events/data-change";
import {
  domainClass,
  daysSince as ds,
  EFFORT_LABEL as EFF,
  type Task,
  type LoopKind,
  type GoalLineageEntry,
} from "@/components/actions/shared";
import { useTaskReviewActions } from "@/hooks/use-task-review-actions";
import { useNowSignals, classifyFit } from "@/hooks/use-now-signals";
import {
  LoopRowItem,
  KindIcon,
  computeWhyLine,
} from "@/components/actions/loop-row-item";
import {
  EFFORT_RANK,
  STATUS_RANK,
  STATUS_HEADER_LABEL,
  scoreUrgency,
  type TaskSortKey,
  type LoopRow,
} from "@/components/actions/loop-scoring";

import { trpc } from "@/lib/trpc/client";
// 2026-05-23 OVERDRIVE · iOS-PWA-safe replacement for window.confirm.
// Native confirm() returns undefined in iOS Safari standalone mode ·
// the cascade prompt silently took the "cancelled" branch every time
// on iPhone homescreen installs. Promise-based hook keeps the
// `const ok = await confirm(...)` call-site shape minimal.
import { useConfirmDialog } from "@/components/ui/confirm-dialog";

interface LoopStreamProps {
  tasks: Task[];
  // 2026-05-23 · task #22 · opts.cascadeChildren carries the
  // operator's yes to "complete N subtasks too?" prompt that
  // LoopStream shows when completing a parent with open children.
  // Existing callers pass id only · the second arg defaults to
  // undefined · legacy behavior preserved.
  onComplete: (
    id: string,
    opts?: { cascadeChildren?: boolean },
  ) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onStart?: (id: string) => void | Promise<void>;
  onPin?: (id: string) => void;
  pinnedIds?: Set<string>;
  /** When a filter is active, show only that kind. */
  kindFilter?: "all" | LoopKind;
  /** Domain filter — show only loops whose mission.domain matches. */
  domainFilter?: string | null;
  /** Text search — filter loops whose title or nextPhysicalAction
   *  contains this string (case-insensitive). */
  searchQuery?: string;
  /** Called when Nour marks a PROMISE broken with a reason. */
  onBreakPromise?: (id: string, reason: string) => void | Promise<void>;
  /** Map of goalId → { title, horizon, domain, paceKind } for lineage
   *  breadcrumbs + pace-aware urgency bump. The paceKind drives the
   *  Apr 27 cross-tab smartness: rows linked to a goal that's
   *  "behind" or "missed" get a priority bump + an urgency chip. */
  // v10.0.529.16 · type imported from shared.ts (was inline here · 1 of 3
  // places · consolidated to single source of truth).
  goalLineage?: Map<string, GoalLineageEntry>;
  /** Apr 26 · F3 — caller invalidator. Fired after kill/reframe/
   *  blocker so the parent reloads the task list. The component
   *  itself owns the action handlers via useTaskReviewActions. */
  onReviewChange?: () => void | Promise<void>;
  /**
   * Apr 27 · GOAL-EDIT — fires when Nour taps the "goal" button on
   * an expanded task row. Parent (tasks page) owns the picker UI
   * (modal sheet with goal list + unlink) so we don't duplicate
   * the goals fetch in this component.
   */
  onEditTaskGoal?: (taskId: string) => void;
  /**
   * May 02 · v10.0.146 · PROJECT-EDIT — fires when Nour taps the
   * "link project" / "change project" button on an expanded row.
   * Pre-fix the only project-axis affordance was "leave project"
   * (clears missionId), with no way to MOVE a task into a project.
   * Parent owns the picker so we don't duplicate the projects fetch.
   */
  onEditTaskMission?: (taskId: string) => void;
  /**
   * 2026-05-23 · task #22 step 5.2 · fired when the operator clicks
   * the "+ subtask" button on a parent row. The parent (`/tasks`
   * page) opens a quick prompt and calls createTask with the
   * parent's missionId + parentTaskId. Optional · graceful when not
   * wired (button hidden when handler is undefined).
   */
  onAddSubtask?: (parent: Task) => void;
  /**
   * v10.0.429 · sort key. Default is "urgency" (auto-priority +
   * pace bump · the historical behavior). Operator can override
   * via the toolbar control on /tasks. Valid keys:
   *   urgency · default · auto-priority + goal-pace bump
   *   title-asc / title-desc · alphabetical
   *   due-soonest / due-latest · dueDate, nulls last
   *   created-newest / created-oldest · createdAt
   *   effort-shortest / effort-longest · M5/M15/M30/H1/H2PLUS bands
   */
  sortKey?: TaskSortKey;
}

// 2026-08-09 · The pure ranking logic that used to live here — TaskSortKey,
// EFFORT_RANK / STATUS_RANK / STATUS_HEADER_LABEL, LoopRow, isDoneTodayForDaily,
// daysUntilDeadline and scoreUrgency — moved to ./loop-scoring.ts, following
// the same extraction pattern as break-promise-modal.tsx and loop-row-item.tsx.
// It is React-free, and trapped inside this "use client" component it could not
// be unit-tested at all: statenour's vitest env is `node` and this file drags in
// trpc, sonner and a dozen hooks. The urgency ladder decides what the operator
// sees FIRST every day and had no direct coverage. It does now.
//
// TaskSortKey is re-exported so the single consumer of this module
// (components/actions/now-panel.tsx) keeps its existing import unchanged.
export type { TaskSortKey } from "@/components/actions/loop-scoring";

export function LoopStream({
  tasks,
  onComplete,
  onDelete,
  onStart,
  onPin,
  pinnedIds,
  kindFilter = "all",
  domainFilter,
  searchQuery,
  onBreakPromise,
  goalLineage,
  onReviewChange,
  onEditTaskGoal,
  onEditTaskMission,
  onAddSubtask,
  sortKey,
}: LoopStreamProps) {
  // 2026-05-23 OVERDRIVE · iOS-PWA-safe confirm dialog · hoisted here
  // (top of component body) so both bulkDelete and onRowComplete can
  // share the same hook instance · dialog mounted once near root.
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  // 2026-05-23 · task #22 · ADR-0017 Rule 3 · subtask child-count
  // maps. Built once per `tasks` array change · O(N) bucketing.
  //
  //   childCountByParent     · total children regardless of status ·
  //                            drives the "+N sub" chip on parent rows
  //   openChildCountByParent · children where status NOT IN [DONE,
  //                            CANCELLED, ARCHIVED] · drives the
  //                            cascade-confirm prompt when completing
  //                            a parent (ADR-0017 Rule 1 Option A)
  //
  // Rebuilt only when the underlying tasks list changes · doesn't
  // depend on filter/sort state (the counts are global).
  const { childCountByParent, openChildCountByParent, doneChildCountByParent } =
    useMemo(() => {
      const total = new Map<string, number>();
      const open = new Map<string, number>();
      // 2026-05-24 · Wave U feature-mining #5 · subtask roll-up · also
      // tracks DONE children so the parent row can show progress
      // (X/N done) instead of just total count. Pure addition · no
      // change to existing total/open consumers.
      const done = new Map<string, number>();
      for (const t of tasks) {
        const pid = t.parentTaskId;
        if (!pid) continue;
        total.set(pid, (total.get(pid) ?? 0) + 1);
        if (t.status === "DONE") {
          done.set(pid, (done.get(pid) ?? 0) + 1);
        }
        if (
          t.status !== "DONE" &&
          t.status !== "CANCELLED" &&
          t.status !== "ARCHIVED"
        ) {
          open.set(pid, (open.get(pid) ?? 0) + 1);
        }
      }
      return {
        childCountByParent: total,
        openChildCountByParent: open,
        doneChildCountByParent: done,
      };
    }, [tasks]);

  // When set, shows an inline modal to capture the break reason.
  // Always the primary flow for PROMISE breakage — the old two-tap
  // confirm fallback was removed since onBreakPromise is now wired
  // by default from the parent.
  const [breakModalFor, setBreakModalFor] = useState<{ id: string; title: string } | null>(null);
  const [breakReason, setBreakReason] = useState("");
  // task.update / task.domainSwap replace PATCH /api/tasks/:id +
  // POST /api/tasks/:id/domain. mutateAsync resolves on success and
  // rejects on error, matching the old `r.ok` branches.
  const updateTask = trpc.task.update.useMutation();
  const domainSwap = trpc.task.domainSwap.useMutation();

  // Apr 26 · F3 — inline kill/reframe/blocker for stale rows. Tapping
  // the STALE chip flips the row into decide-mode; the three verbs
  // appear under the row body. Reframe + blocker have inline inputs.
  const [decideId, setDecideId] = useState<string | null>(null);
  const [reframeText, setReframeText] = useState("");
  const [blockerText, setBlockerText] = useState("");
  const [pendingMode, setPendingMode] = useState<"reframe" | "blocker" | null>(null);
  const review = useTaskReviewActions({
    source: "page:tasks/now/stale-chip",
    onChange: onReviewChange,
  });

  // Apr 26 · F7 — tap-to-expand row. Tapping the title (or the row
  // body anywhere outside the complete circle / chip buttons) toggles
  // the expanded panel which reveals: full title, finish condition,
  // mission/goal lineage, all metadata chips, the WHY line, plus
  // primary action buttons (Start, Edit, Pin, Delete). Tap again to
  // collapse. Only one expanded at a time so the stream stays lean.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // v10.0.529.14 · useCallback so the LoopRowItem's onToggleExpand
  // ref is stable across renders. Without this every state change
  // higher up in the parent would invalidate memo equality on the
  // row's prop bag and cascade re-renders to every sibling.
  const toggleExpand = useCallback((id: string) => {
    setExpandedId((curr) => (curr === id ? null : id));
  }, []);

  // Apr 26 · F11 — optimistic spinner state per row. Tap the
  // complete circle → row enters "completing" state immediately
  // (spinner + line-through preview) while the mutation is in
  // flight. If the mutation fails, the parent's onChange / refresh
  // brings it back; otherwise the row drops out on next render.
  const [completingIds, setCompletingIds] = useState<Set<string>>(new Set());

  // Apr 26 · F4 — inline snooze popover state. When a task's
  // expanded panel "snooze" button is tapped, this stores the row
  // id so we can render the +1d/+3d/+1w buttons in place of the
  // default action row until the user picks one (or cancels).
  const [snoozingId, setSnoozingId] = useState<string | null>(null);

  // Apr 27 · DOMAIN-EDIT — tap the DOMAIN value in the expanded
  // metadata grid to switch which domain a task belongs to. Posts to
  // /api/tasks/[id]/domain which finds-or-creates a per-domain Inbox
  // mission and swaps missionId. Set null when no row is editing.
  const [domainEditId, setDomainEditId] = useState<string | null>(null);
  const [domainSwapBusy, setDomainSwapBusy] = useState(false);
  // v10.0.529.13 · single source of truth via useCustomDomains hook.
  // Pre-fix this component re-parsed localStorage on every
  // `domainEditId` change and could drift mid-session from the
  // parent's list. Now the hook subscribes to the synthetic
  // StorageEvent dispatched by the parent's setter and stays in sync
  // automatically · no manual re-read.
  const { customDomains: customDomainOptions } = useCustomDomains();

  // Apr 26 · F1 — inline edit state. When `editingId` matches a row,
  // the expanded panel renders the edit form instead of the static
  // metadata view. Form fields mirror the editable Task columns.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editAction, setEditAction] = useState("");
  const [editEffort, setEditEffort] = useState("");
  const [editDueDate, setEditDueDate] = useState("");

  // Apr 26 · F10 — drag-to-reorder. HTML5 drag is good enough for
  // desktop; mobile gets the same UX via long-press → drag (works
  // out of the box on iOS Safari with `draggable=true`). On drop,
  // we set the dragged task's manualPriorityOverride to one above
  // the target's score so the new order persists across reloads.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // v10.0.530 · BULK-SELECT. Sibling wrapper around LoopRowItem (no
  // row-internal changes) so it stays orthogonal to pin/expand/drag.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const toggleSelectMode = useCallback(() => {
    setSelectMode((m) => { if (m) setSelectedIds(new Set()); return !m; });
  }, []);
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const exitSelect = useCallback(() => { setSelectMode(false); setSelectedIds(new Set()); }, []);
  const runBulk = useCallback(async (fn: (id: string) => void | Promise<void>) => {
    const ids = Array.from(selectedIds);
    setBulkBusy(true);
    // 2026-05-24 · Wave U silent-failure P0 · pre-fix the loop awaited
    // each fn() and the first rejection threw out of runBulk before
    // notifyDataChanged · operator selected 10 tasks, task 3 failed,
    // tasks 4-10 silently skipped, no toast disclosed the partial
    // failure. Now: per-iteration catch · accumulate failedIds ·
    // single toast summarizing partial completion at the end. The
    // finally still resets bulk state so the UI exits select-mode
    // even on partial fail.
    const failedIds: string[] = [];
    try {
      for (const id of ids) {
        try {
          await fn(id);
        } catch (err) {
          failedIds.push(id);
          // Don't swallow into the void · reportClientError lands in
          // /system/errors so the operator can diagnose post-hoc.
          try {
            const { reportClientError } = await import(
              "@/components/ui/client-error-telemetry"
            );
            reportClientError(err, {
              source: `loop-stream.runBulk · task=${id}`,
            });
          } catch {
            // reporter failure is acceptable degradation
          }
        }
      }
    } finally {
      setBulkBusy(false);
      setSelectMode(false);
      setSelectedIds(new Set());
      if (failedIds.length > 0) {
        const done = ids.length - failedIds.length;
        toast.error(
          `${done} of ${ids.length} completed · ${failedIds.length} failed`,
        );
      }
    }
  }, [selectedIds]);
  const bulkSnooze = useCallback(async () => {
    await runBulk(async (id) => {
      // Sends only { status: "WAITING" } · the legacy PATCH also sent
      // a `snoozedUntil` but taskUpdateSchema (REST + tRPC) has no
      // such key, so it was stripped before reaching Prisma — the
      // snooze date was never persisted. Migrating to the typed
      // task.update keeps the persisted result identical.
      await updateTask.mutateAsync({ id, fields: { status: "WAITING" } });
    });
    notifyDataChanged("tasks", { source: "loop-stream", detail: "bulk-snooze" });
    await onReviewChange?.();
  }, [runBulk, onReviewChange, updateTask]);
  // 2026-05-23 OVERDRIVE · iOS-PWA-safe bulk-delete confirmation.
  // Was `confirm(...)` · the global window.confirm also silently
  // suppresses in iOS PWA standalone mode · before this fix, the
  // bulk-delete on iPhone never confirmed and the early-return
  // ALWAYS fired (operator hits Delete · nothing happens).
  const bulkDelete = useCallback(async () => {
    // 2026-05-24 · Wave U ux-F3 · pre-fix the confirm only fired for
    // counts > 5 · selecting 2-5 tasks would wipe them with no prompt
    // and no undo (the deletes are sequential soft-deletes via
    // onDelete · destructive in batch). Now: any count ≥ 2 confirms
    // with the count in the prompt · matches the iOS HIG mass-action
    // pattern. Single-task delete still happens via the per-row trash
    // affordance which has its own confirmation path.
    if (selectedIds.size >= 2) {
      const ok = await confirm({
        title: `Delete ${selectedIds.size} task${selectedIds.size === 1 ? "" : "s"}?`,
        body: "This action cannot be undone.",
        confirmLabel: "Delete",
        cancelLabel: "Keep",
        tone: "danger",
      });
      if (!ok) return;
    }
    await runBulk(onDelete);
  }, [confirm, selectedIds.size, runBulk, onDelete]);
  // v10.0.529.14 · useCallback for stable ref across renders so the
  // memoized LoopRowItem doesn't re-render when sibling state ticks.
  const handleCompleteWithSpinner = useCallback(
    async (id: string, opts?: { cascadeChildren?: boolean }) => {
      setCompletingIds((prev) => new Set(prev).add(id));
      try {
        await onComplete(id, opts);
      } finally {
        // Defer clearing so the row isn't briefly back-to-circle if
        // the parent reload is fast — doneToday flips first.
        setTimeout(() => {
          setCompletingIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        }, 600);
      }
    },
    [onComplete],
  );
  // Adapter to fit LoopRowItem's `onComplete: (id) => void` signature
  // — the row doesn't care about the promise, the parent does (via the
  // spinner-clearing setTimeout).
  //
  // 2026-05-23 · task #22 · ADR-0017 Rule 1 Option A · cascade-confirm
  // prompt. When completing a row that has open children, show a
  // confirm "complete N subtasks too?" · operator's yes passes
  // cascadeChildren=true down the chain · server cascades atomically.
  //
  // 2026-05-23 OVERDRIVE · cascade prompt was window.confirm() ·
  // silently suppressed in iOS Safari standalone mode (PWA install)
  // so the prompt never blocked + the cascade ALWAYS took the
  // "cancelled" branch on iPhone homescreen. Now uses the
  // hoisted `confirm` from useConfirmDialog() at top of component.
  const onRowComplete = useCallback(
    async (id: string) => {
      const openChildren = openChildCountByParent.get(id) ?? 0;
      if (openChildren > 0) {
        const ok = await confirm({
          title: `Complete ${openChildren} subtask${openChildren === 1 ? "" : "s"} too?`,
          body: `This task has ${openChildren} open subtask${openChildren === 1 ? "" : "s"}. Tap confirm to complete ${openChildren === 1 ? "it" : "them all"} in one shot. Cancel to leave ${openChildren === 1 ? "it" : "them"} open.`,
          confirmLabel: "Complete all",
          cancelLabel: "Leave children open",
        });
        if (ok) {
          void handleCompleteWithSpinner(id, { cascadeChildren: true });
          return;
        }
        // Operator chose to leave children open · per amended Rule 1
        // this is allowed (the prompt is opt-out) · existing legacy
        // behavior takes over below.
      }
      void handleCompleteWithSpinner(id);
    },
    [confirm, handleCompleteWithSpinner, openChildCountByParent],
  );

  // v10.0.529.14 · stable callbacks for the LoopRowItem boundary.
  // Each one is a setter wrapped in a closure so the row only needs
  // to pass the task id (or value) — the parent owns the state. The
  // dep lists are intentionally minimal so identity stays stable
  // across most re-renders.
  const onOpenEditFromRow = useCallback((task: Task) => {
    setEditingId(task.id);
    setExpandedId(task.id);
    setEditTitle(task.title);
    setEditAction(task.nextPhysicalAction || "");
    setEditEffort(task.effort || "M30");
    setEditDueDate(
      task.dueDate
        ? new Date(task.dueDate).toISOString().slice(0, 10)
        : "",
    );
  }, []);

  const onOpenEditFromPanel = useCallback((task: Task) => {
    setEditingId(task.id);
    setEditTitle(task.title);
    setEditAction(task.nextPhysicalAction || "");
    setEditEffort(task.effort || "M30");
    setEditDueDate(
      task.dueDate
        ? new Date(task.dueDate).toISOString().slice(0, 10)
        : "",
    );
  }, []);

  const onCancelEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  // Save the edit. The edit-* text fields are read at call time, so
  // this callback's identity DOES change when any edit field changes
  // — that's fine: only the row currently in edit-mode receives this
  // as a prop, so the keystroke-driven re-render is contained to
  // that ONE row. Every other sibling's props are unchanged and the
  // memo bails them out. Pre-extraction this was inlined and ALL
  // rows re-rendered on every keystroke.
  const onSaveEdit = useCallback(
    async (task: Task) => {
      const patch: Record<string, unknown> = {};
      if (editTitle.trim() && editTitle !== task.title) patch.title = editTitle.trim();
      if (editAction !== (task.nextPhysicalAction || "")) {
        patch.nextPhysicalAction = editAction.trim() || task.title;
      }
      if (editEffort !== task.effort) patch.effort = editEffort;
      if (editDueDate) {
        const newDate = new Date(`${editDueDate}T23:59:59.999Z`).toISOString();
        const existingDate = task.dueDate ? new Date(task.dueDate).toISOString() : null;
        if (newDate !== existingDate) patch.dueDate = newDate;
      } else if (task.dueDate) {
        patch.dueDate = null;
      }
      if (Object.keys(patch).length > 0) {
        await review.edit(task.id, patch);
      }
      setEditingId(null);
      setExpandedId(null);
    },
    // v10.0.529.14 fix · post-extraction reviewer caught that the
    // outer `review` object identity is recreated every render (the
    // hook returns a fresh object even though its methods are stable
    // useCallbacks). Depend on `review.edit` specifically · stable
    // by construction · won't churn this callback on parent ticks.
    [editTitle, editAction, editEffort, editDueDate, review.edit],
  );

  const onOpenDecide = useCallback((task: Task) => {
    setDecideId(task.id);
    setPendingMode(null);
    setReframeText(task.title);
    setBlockerText("");
  }, []);

  const onCancelDecide = useCallback(() => {
    setDecideId(null);
    setPendingMode(null);
  }, []);

  const onSetDecideMode = useCallback((mode: "reframe" | "blocker" | null) => {
    setPendingMode(mode);
  }, []);

  const onCommitKill = useCallback(
    async (taskId: string) => {
      await review.kill(taskId);
      setDecideId(null);
    },
    [review],
  );

  const onCommitReframe = useCallback(
    async (taskId: string, title: string) => {
      await review.reframe(taskId, { title });
      setDecideId(null);
      setPendingMode(null);
    },
    [review],
  );

  const onCommitBlocker = useCallback(
    async (taskId: string, waitingOn: string) => {
      await review.blocker(taskId, waitingOn);
      setDecideId(null);
      setPendingMode(null);
    },
    [review],
  );

  const onOpenSnooze = useCallback((taskId: string) => {
    setSnoozingId(taskId);
  }, []);

  const onCancelSnooze = useCallback(() => {
    setSnoozingId(null);
  }, []);

  const onCommitSnooze = useCallback(
    async (taskId: string, days: number) => {
      await review.snooze(taskId, days);
      setSnoozingId(null);
      setExpandedId(null);
    },
    [review],
  );

  const onOpenDomainEdit = useCallback((taskId: string) => {
    setDomainEditId(taskId);
  }, []);

  const onCancelDomainEdit = useCallback(() => {
    setDomainEditId(null);
  }, []);

  // v10.0.529.14 · domain swap moved into the parent so the row stays
  // presentational. Pre-extraction this was inline in the row map and
  // captured the mutation/toast/notifyDataChanged via closure; same
  // semantics here, just hoisted one level so the boundary is cleaner.
  const onCommitDomainSwap = useCallback(
    async (taskId: string, domain: string) => {
      setDomainSwapBusy(true);
      try {
        await domainSwap.mutateAsync({ id: taskId, domain });
        toast.success(`Domain → ${domain}`);
        notifyDataChanged("tasks", {
          source: "loop-stream",
          detail: "domain-swap",
          id: taskId,
        });
        notifyDataChanged("missions", {
          source: "loop-stream",
          detail: "domain-swap",
        });
        await onReviewChange?.();
        setDomainEditId(null);
      } catch {
        toast.error("Domain change failed");
      } finally {
        setDomainSwapBusy(false);
      }
    },
    [onReviewChange, domainSwap],
  );

  const onOpenBreakModal = useCallback((taskId: string, title: string) => {
    setBreakModalFor({ id: taskId, title });
    setBreakReason("");
  }, []);

  const onCollapse = useCallback(() => {
    setExpandedId(null);
  }, []);

  // Drag-and-drop callbacks. dragStart/dragEnd identity is fully
  // stable. dragOver/dragLeave/drop CAN change identity when their
  // dep state ticks (draggingId/dragOverId). Since drag is a
  // visually-heavy interaction that already paints all rows
  // (opacity-30 on the dragged row, ring on the dragOver row), the
  // cascade during drag is acceptable. The wins are NON-DRAG state
  // interactions (edit/snooze/decide) which now isolate correctly.
  const onRowDragStart = useCallback(
    (taskId: string, e: React.DragEvent<HTMLDivElement>) => {
      setDraggingId(taskId);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", taskId);
    },
    [],
  );
  const onRowDragEnd = useCallback(() => {
    setDraggingId(null);
    setDragOverId(null);
  }, []);
  const onRowDragOver = useCallback(
    (taskId: string, e: React.DragEvent<HTMLDivElement>) => {
      if (draggingId && draggingId !== taskId) {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDragOverId(taskId);
      }
    },
    [draggingId],
  );
  const onRowDragLeave = useCallback(
    (taskId: string) => {
      if (dragOverId === taskId) setDragOverId(null);
    },
    [dragOverId],
  );
  const onRowDrop = useCallback(
    async (taskId: string, urgency: number, e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const draggedId = e.dataTransfer.getData("text/plain") || draggingId;
      setDraggingId(null);
      setDragOverId(null);
      if (!draggedId || draggedId === taskId) return;
      // Place dragged task above this target — bump its
      // manualPriorityOverride to (target effective + 1).
      // The target's effective priority is the auto score
      // OR the manual override, whichever is set. We
      // approximate from the row.urgency since auto-priority
      // surface isn't always populated client-side.
      const targetUrgency = urgency || 50;
      // 2026-05-24 · Wave U silent-failure P0 · pre-fix review.edit()
      // failure was masked by the hook's generic "Saved." toast on
      // success · operator dragged a row, saw it move locally, got
      // "Saved." even on server reject, then on next reload (60s)
      // the row snapped back with zero explanation. Now: wrap the
      // mutation · on failure roll back the visual immediately + toast
      // the reorder failure explicitly. The hook's success toast still
      // fires correctly on the happy path.
      try {
        await review.edit(draggedId, {
          manualPriorityOverride: Math.min(99, Math.max(1, targetUrgency + 1)),
        });
      } catch (err) {
        // Triggering an immediate reload pulls the canonical server
        // order back so the operator sees the snap-back inside <1s
        // rather than waiting for the 60s poll.
        try {
          const { reportClientError } = await import(
            "@/components/ui/client-error-telemetry"
          );
          reportClientError(err, {
            source: `loop-stream.onRowDrop · dragged=${draggedId} target=${taskId}`,
          });
        } catch {
          // reporter failure is acceptable degradation
        }
        toast.error("Reorder failed · snapping back");
        await onReviewChange?.();
      }
    },
    [draggingId, review, onReviewChange],
  );

  // Apr 26 · F6 — live state-aware row coloring + fit chips. Pure
  // client derivation (no fetch); updates whenever NourState or
  // tasks change.
  const liveSignals = useNowSignals(tasks);

  const rows = useMemo<LoopRow[]>(() => {
    const active = tasks.filter((t) => ["INBOX", "READY", "DOING"].includes(t.status));
    const enriched = active.map((t): LoopRow => {
      const kind: LoopKind = (t.loopKind as LoopKind) || "ONCE";
      // Apr 27 · pull the linked goal's pace verdict so scoreUrgency
      // can apply a cross-tab bump when the goal is behind/missed.
      const paceKind = t.goalId ? goalLineage?.get(t.goalId)?.paceKind : undefined;
      return { task: t, kind, ...scoreUrgency(t, paceKind) };
    });

    // Apply all three filter dimensions: kind → domain → search
    let filtered = enriched;
    if (kindFilter !== "all") {
      filtered = filtered.filter((r) => r.kind === kindFilter);
    }
    if (domainFilter) {
      // 2026-05-24 · Wave U code-review #8 · pre-fix: typed `work`
      // filter never matched `BUSINESS` tasks because the anchor
      // mapping (work → BUSINESS) lives only in loop-row-item.tsx:1040
      // (the picker) and never in the filter compare. Symptom: filter
      // by `work` shows zero tasks even when business tasks are
      // present. Now apply the same alias on both sides.
      const df = (domainFilter === "work" ? "business" : domainFilter).toLowerCase();
      filtered = filtered.filter((r) => {
        const dom = (r.task.mission?.domain ?? "other").toLowerCase();
        return dom === df;
      });
    }
    if (searchQuery && searchQuery.trim().length >= 2) {
      const q = searchQuery.trim().toLowerCase();
      filtered = filtered.filter((r) => {
        const title = r.task.title.toLowerCase();
        const next = (r.task.nextPhysicalAction || "").toLowerCase();
        const promise = (r.task.promiseTo || "").toLowerCase();
        return title.includes(q) || next.includes(q) || promise.includes(q);
      });
    }

    // v10.0.429 · sort dispatch · default = urgency (legacy behavior).
    const key: TaskSortKey = sortKey ?? "urgency";
    const titleA = (r: LoopRow) => r.task.title.toLowerCase();
    const dueAt = (r: LoopRow) => r.task.dueDate ? new Date(r.task.dueDate).getTime() : null;
    const createdAt = (r: LoopRow) => r.task.createdAt ? new Date(r.task.createdAt).getTime() : 0;
    const effort = (r: LoopRow) => EFFORT_RANK[r.task.effort ?? "M30"] ?? 2;
    const statusRank = (r: LoopRow) => STATUS_RANK[r.task.status] ?? 99;
    const cmpNullable = (a: number | null, b: number | null, asc: boolean) => {
      if (a === null && b === null) return 0;
      if (a === null) return 1; // nulls last
      if (b === null) return -1;
      return asc ? a - b : b - a;
    };
    switch (key) {
      case "title-asc":
        filtered.sort((a, b) => titleA(a).localeCompare(titleA(b)));
        break;
      case "title-desc":
        filtered.sort((a, b) => titleA(b).localeCompare(titleA(a)));
        break;
      case "due-soonest":
        filtered.sort((a, b) => cmpNullable(dueAt(a), dueAt(b), true));
        break;
      case "due-latest":
        filtered.sort((a, b) => cmpNullable(dueAt(a), dueAt(b), false));
        break;
      case "created-newest":
        filtered.sort((a, b) => createdAt(b) - createdAt(a));
        break;
      case "created-oldest":
        filtered.sort((a, b) => createdAt(a) - createdAt(b));
        break;
      case "effort-shortest":
        filtered.sort((a, b) => effort(a) - effort(b));
        break;
      case "effort-longest":
        filtered.sort((a, b) => effort(b) - effort(a));
        break;
      case "by-status":
        // Primary key: STATUS_RANK (DOING → READY → INBOX → WAITING).
        // Secondary key inside a status bucket: urgency desc, so within
        // "doing" the highest-urgency rows still float to the top.
        filtered.sort((a, b) => {
          const s = statusRank(a) - statusRank(b);
          return s !== 0 ? s : b.urgency - a.urgency;
        });
        break;
      case "urgency":
      default:
        filtered.sort((a, b) => b.urgency - a.urgency);
        break;
    }
    return filtered;
  }, [tasks, kindFilter, domainFilter, searchQuery, goalLineage, sortKey]);

  // Apr 26 · F8 — pinned tasks ride a separate band above the main
  // stream. They keep their kind/state visuals but always sit on top
  // regardless of urgency score, so Nour's manual override is
  // visually persistent.
  const { pinnedRows, mainRows } = useMemo(() => {
    if (!pinnedIds || pinnedIds.size === 0) {
      return { pinnedRows: [] as LoopRow[], mainRows: rows };
    }
    const pinned: LoopRow[] = [];
    const main: LoopRow[] = [];
    for (const r of rows) {
      if (pinnedIds.has(r.task.id)) pinned.push(r);
      else main.push(r);
    }
    return { pinnedRows: pinned, mainRows: main };
  }, [rows, pinnedIds]);

  // Find the Next Move — top-ranked row that isn't already completed
  // today. Pinned tasks win the hero slot when present so Nour's
  // manual focus is honored. Computed BEFORE the early return so
  // hook order stays stable.
  const nextMove =
    pinnedRows.find((r) => !r.doneToday) ||
    mainRows.find((r) => !r.doneToday) ||
    pinnedRows[0] ||
    mainRows[0];

  // ── Keyboard shortcuts ──
  // c = complete next move, s = start next move, shift+d = delete
  // next move. j/k row-focus nav was an open TODO from the loop-
  // stream extraction wave · the in-stream hero card + the global
  // <NextMoveCard> at the top of NOW make a vim-style cursor less
  // valuable than first imagined. Removed Wave 26 audit cleanup
  // (A7) · ergonomics ship via the global ⌘K palette + the hero
  // card · row-focus stays unshipped until there's a real demand.
  //
  // Bail out if the target is an input/textarea so we don't hijack
  // typing. Must sit above the early-return so the useEffect is
  // called on every render — otherwise React sees a conditional hook.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || target.isContentEditable) {
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!nextMove) return;
      switch (e.key.toLowerCase()) {
        case "c":
          e.preventDefault();
          onComplete(nextMove.task.id);
          break;
        case "s":
          if (onStart && nextMove.task.status !== "DOING") {
            e.preventDefault();
            onStart(nextMove.task.id);
          }
          break;
        case "d":
          // Only delete with shift+d to avoid typos hosing the hero
          if (e.shiftKey) {
            e.preventDefault();
            onDelete(nextMove.task.id);
          }
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [nextMove, onComplete, onStart, onDelete]);

  // v10.0.529.14 fix · post-extraction reviewer flagged the inline
  // arrow callbacks on BreakPromiseModal as inconsistent with the
  // useCallback discipline applied to the other 29 handlers · and
  // `onConfirm` had a real stale-closure risk because it reads
  // `breakModalFor` + `breakReason`. Wrap both with explicit deps
  // so the modal child sees stable refs.
  const handleBreakCancel = useCallback(() => {
    setBreakModalFor(null);
    setBreakReason("");
  }, []);
  const handleBreakConfirm = useCallback(async () => {
    if (!breakModalFor || !onBreakPromise) return;
    await onBreakPromise(breakModalFor.id, breakReason.trim());
    setBreakModalFor(null);
    setBreakReason("");
  }, [breakModalFor, breakReason, onBreakPromise]);

  if (rows.length === 0) {
    return (
      <div className="rounded-xl bg-zinc-900/30 border border-zinc-800/30 p-6 text-center">
        <p className="text-[11px] text-zinc-500 italic">
          No active routines. Clean slate — add your first move above.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 2026-05-23 OVERDRIVE · cascade-confirm modal · iOS-PWA-safe
       *   replacement for window.confirm() · renders null when closed
       *   so no perf cost in the steady-state. See useConfirmDialog
       *   hook for the call-site shape. */}
      {confirmDialog}
      {/* ── BREAK PROMISE MODAL — inline reason capture ──
       *
       * v10.0.529.13 a11y · added role="dialog" + aria-modal +
       * aria-labelledby/describedby + Escape-to-close + focus return
       * to the originating row. Without these, iOS VoiceOver users
       * could read content behind the modal and keyboard users could
       * tab into the underlying page. Standard WCAG 2.1 modal pattern.
       */}
      {breakModalFor && (
        <BreakPromiseModal
          task={breakModalFor}
          reason={breakReason}
          onReasonChange={setBreakReason}
          onCancel={handleBreakCancel}
          onConfirm={handleBreakConfirm}
        />
      )}

      {/* 2026-05-24 · Wave U feature-mining #2 · capacity meter ·
          surfaces the operator's realistic remaining minutes today
          (from rolling 30d completion rate) vs total allocated minutes
          across READY+DOING tasks. Pulled from useNowSignals which
          was already computing it but never rendered. When
          overcommitted, the line shifts amber (not red · no AI-slop).
          Silent when there's nothing to show (zero tasks · zero
          capacity computed). */}
      {(liveSignals.capacityRemainingMin > 0 || liveSignals.allocatedMin > 0) && (
        <div
          className={cn(
            "flex items-center gap-2 rounded-md px-2 py-1 text-[10px] font-mono",
            liveSignals.overcommitted
              ? "border border-amber-500/30 bg-amber-500/5 text-amber-300"
              : "border border-[var(--border-default)] bg-[var(--bg-void)]/40 text-[var(--text-tertiary)]",
          )}
          title={
            liveSignals.overcommitted
              ? `${liveSignals.allocatedMin}m allocated · only ${liveSignals.capacityRemainingMin}m left today · ${liveSignals.allocatedMin - liveSignals.capacityRemainingMin}m over`
              : `${liveSignals.allocatedMin}m allocated · ${liveSignals.capacityRemainingMin}m left today`
          }
        >
          <span className="font-bold uppercase tracking-wider">capacity</span>
          <span className="tabular-nums">
            {Math.floor(liveSignals.capacityRemainingMin / 60)}h{" "}
            {liveSignals.capacityRemainingMin % 60}m left today
          </span>
          <span className="text-[var(--text-tertiary)]/60">·</span>
          <span className="tabular-nums">
            {Math.floor(liveSignals.allocatedMin / 60)}h{" "}
            {liveSignals.allocatedMin % 60}m allocated
          </span>
          {liveSignals.overcommitted && (
            <span className="ml-auto tabular-nums">
              {Math.floor(
                (liveSignals.allocatedMin - liveSignals.capacityRemainingMin) /
                  60,
              )}
              h{" "}
              {(liveSignals.allocatedMin - liveSignals.capacityRemainingMin) %
                60}
              m over
            </span>
          )}
        </div>
      )}

      {/* ── NEXT MOVE hero — the single smartest next action ── */}
      {nextMove && (
        <div className="relative rounded-xl border border-[var(--gold)]/30 bg-gradient-to-br from-[var(--gold)]/10 via-zinc-900/60 to-zinc-900/40 p-3 overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(253,185,19,0.08),transparent_60%)] pointer-events-none" />
          <div className="relative flex items-start gap-2.5">
            <button
              onClick={() => void handleCompleteWithSpinner(nextMove.task.id)}
              disabled={completingIds.has(nextMove.task.id)}
              className={cn(
                "mt-0.5 shrink-0 transition-colors",
                completingIds.has(nextMove.task.id)
                  ? "text-emerald-400"
                  : "text-[var(--gold)]/60 hover:text-[var(--gold)]"
              )}
              aria-label="Complete"
            >
              {completingIds.has(nextMove.task.id) ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Circle size={18} />
              )}
            </button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-[8px] font-bold uppercase tracking-[0.2em] text-[var(--gold)]/70">
                  Next move
                </span>
                <KindIcon kind={nextMove.kind} size={10} />
                <span className="text-[8px] font-bold text-[var(--gold)]/70 uppercase">
                  {nextMove.kind.toLowerCase()}
                </span>
                {/* Keyboard hint — only shown on the hero since that's
                    where the shortcuts act by default. Tiny + dim so
                    it doesn't dominate the gold headline. */}
                <span className="ml-auto text-[7px] text-zinc-700 font-mono uppercase tracking-wider hidden sm:inline">
                  c complete · s start · ⇧d del
                </span>
              </div>
              {/* Apr 27 · HERO-EXPAND — tap title → toggles the row's
                  expanded panel below. The row map un-skips this task
                  when expandedId matches, so the same details panel
                  (events, metadata, action buttons) appears under the
                  hero without us duplicating the JSX. */}
              <button
                type="button"
                onClick={() => toggleExpand(nextMove.task.id)}
                className="text-left w-full"
                aria-expanded={expandedId === nextMove.task.id}
              >
                <p className="text-[14px] font-bold text-zinc-100 leading-snug hover:text-white">
                  {nextMove.task.title}
                </p>
                {nextMove.task.nextPhysicalAction && nextMove.task.nextPhysicalAction !== nextMove.task.title && (
                  <p className="text-[10px] text-zinc-400 mt-0.5">→ {nextMove.task.nextPhysicalAction}</p>
                )}
              </button>
              {/* Apr 27 · GB5 — sharpened goal chip on hero too so
                  the lift signal is consistent with the rest of the
                  stream. Purple = goal-tagged, gold = mission fallback. */}
              {nextMove.task.goalId && goalLineage?.get(nextMove.task.goalId) ? (
                <div className="mt-0.5 flex items-center gap-1 flex-wrap">
                  <span
                    className="inline-flex items-center gap-1 rounded border border-violet-500/30 bg-violet-500/5 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider text-violet-300 max-w-full"
                    title="Completing this task auto-lifts this goal"
                  >
                    <Target size={9} className="shrink-0" />
                    <span className="truncate">
                      {goalLineage.get(nextMove.task.goalId)!.title}
                    </span>
                    {goalLineage.get(nextMove.task.goalId)!.horizon && (
                      <span className="text-violet-400/60 shrink-0">
                        · {goalLineage.get(nextMove.task.goalId)!.horizon}
                      </span>
                    )}
                  </span>
                </div>
              ) : nextMove.task.mission?.title && nextMove.task.mission.title !== "Inbox" ? (
                <p className="text-[9px] text-zinc-600 mt-0.5 truncate">
                  ↳ {nextMove.task.mission.title}
                </p>
              ) : null}
              {/* Apr 26 · F5 — WHY line. The single reason this is
                  Next Move. Pulled from the row's urgency signals +
                  the task's age/effort/streak. Renders only when the
                  reason is non-obvious. */}
              {(() => {
                const why = computeWhyLine({
                  task: nextMove.task,
                  kind: nextMove.kind,
                  ageDays: ds(nextMove.task.createdAt),
                  daysUntilDeadline: nextMove.daysUntilDeadline,
                  overdue: nextMove.overdue,
                });
                if (!why) return null;
                return (
                  <p className="text-[10px] text-[var(--gold)]/80 mt-1 italic flex items-center gap-1.5">
                    <span className="text-[var(--gold)]/50 font-mono uppercase tracking-wider text-[8px] not-italic">
                      why
                    </span>
                    <span className="truncate">{why}</span>
                  </p>
                );
              })()}
              <div className="flex items-center gap-2 mt-1.5 text-[9px] flex-wrap">
                {nextMove.task.mission?.domain && (
                  <Badge className={cn("h-3.5 text-[8px] border-0", domainClass(nextMove.task.mission.domain))}>
                    {nextMove.task.mission.domain.toLowerCase()}
                  </Badge>
                )}
                {nextMove.task.effort && (
                  <span className="text-zinc-500 font-mono">{EFF[nextMove.task.effort] || nextMove.task.effort}</span>
                )}
                {nextMove.kind === "PROMISE" && nextMove.task.promiseTo && (
                  <span className="text-violet-300">@ {nextMove.task.promiseTo}</span>
                )}
                {nextMove.kind === "PROMISE" && nextMove.daysUntilDeadline !== null && (
                  <span
                    className={cn(
                      nextMove.overdue
                        ? "text-red-400"
                        : nextMove.daysUntilDeadline <= 2
                          ? "text-amber-400"
                          : "text-zinc-500"
                    )}
                  >
                    <Clock size={9} className="inline mr-0.5" />
                    {nextMove.overdue
                      ? `${Math.abs(nextMove.daysUntilDeadline)}d overdue`
                      : nextMove.daysUntilDeadline === 0
                        ? "today"
                        : `${nextMove.daysUntilDeadline}d`}
                  </span>
                )}
                {nextMove.kind === "DAILY" && (nextMove.task.streakCount ?? 0) > 0 && (
                  <span className="text-amber-400 font-mono">🔥 {nextMove.task.streakCount}</span>
                )}
              </div>
            </div>
            {onStart && nextMove.task.status !== "DOING" && (
              <button
                onClick={() => onStart(nextMove.task.id)}
                className="shrink-0 text-zinc-500 hover:text-blue-400 transition-colors"
                aria-label="Start"
                title="Start"
              >
                <Zap size={12} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Apr 26 · F8 — pinned band header. Renders only when there
          are pinned rows that aren't already the hero. */}
      {pinnedRows.length > 0 && pinnedRows.some((r) => r !== nextMove) && (
        <div className="flex items-center gap-1.5 px-2 pt-1 pb-0.5 text-[8px] font-mono uppercase tracking-wider text-[var(--gold)]/70">
          <Pin size={8} />
          <span>pinned · {pinnedRows.length}</span>
          <div className="flex-1 h-px bg-gradient-to-r from-[var(--gold)]/20 to-transparent" />
        </div>
      )}

      {/* v10.0.530 · BULK-SELECT toggle. Above the stream, gold when on. */}
      <div className="flex justify-end px-1">
        <button type="button" onClick={toggleSelectMode} aria-pressed={selectMode} className={cn("text-[9px] font-mono uppercase tracking-wider px-2 py-1 rounded transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gold)]/60", selectMode ? "text-[var(--gold)] bg-[var(--gold)]/10" : "text-zinc-500 hover:text-zinc-300")}>
          {selectMode ? `selecting · ${selectedIds.size}` : "select"}
        </button>
      </div>

      {/* ── The stream ── pinned rows first, then main rows. Hero
          card may pull either to the top slot via nextMove.
          v10.0.529.14 · row body extracted to memoized LoopRowItem.
          Per-row state is derived from the parent's Sets/IDs into
          BOOLEANS at this layer, so the memo bails out for every
          row whose flags didn't change.

          2026-05-23 · Todoist/Evernote-style kind-section dividers.
          When the stream is sorted by urgency (default), insert a
          tiny eyebrow header between consecutive rows of different
          loopKind so DAILY · PROMISE · ONCE clusters read as
          separate sections. The data + order are untouched — this
          is a pure render-time visual grouping. Skipped for non-
          urgency sorts (title / due / created / effort) since
          kind-mixing is expected there. Also skipped inside the
          pinned band — pinned rows are a manual override band
          where kind shouldn't be re-segmented. */}
      <div className={cn("space-y-0.5", selectedIds.size > 0 && "pb-16")}>
        {(() => {
          const showKindSections = (sortKey ?? "urgency") === "urgency";
          // 2026-05-23 · task #20 · second grouping axis. Mutually
          // exclusive with kind-section grouping (sortKey is either
          // "urgency" → kind axis OR "by-status" → status axis OR any
          // other sort → no section dividers).
          const showStatusSections = sortKey === "by-status";
          // Track the previous emitted main-row kind across the map
          // closure. Pinned rows skip section emission (handled below).
          let prevMainKind: LoopKind | null = null;
          let prevMainStatus: string | null = null;
          return [...pinnedRows, ...mainRows].map((row, idx) => {
          // Skip the nextMove's DOUBLE render — it's already shown in
          // the hero card above. Apr 27 · HERO-EXPAND — when Nour taps
          // the hero card title we set expandedId = hero.task.id. We
          // let the row through in that case so the expanded panel
          // renders below the hero (same details JSX as every other
          // row, no duplication).
          if (row === nextMove && expandedId !== row.task.id) return null;
          const { task, kind, urgency, overdue, doneToday, daysUntilDeadline } = row;
          // 2026-05-23 · Kind-section eyebrow header.
          // Emit a header before this row when:
          //   · sortKey is urgency (default)
          //   · this row is a MAIN row (idx >= pinnedRows.length)
          //   · its kind differs from the previously emitted main-row
          //     kind (so consecutive same-kind rows get ONE header)
          //   · a kindFilter isn't active (no point segmenting when
          //     the user has narrowed to a single kind already)
          // The header carries no semantic state — it's purely
          // visual hierarchy. Skip for pinned rows (the pinned band
          // is a manual override; kind-segmenting it would fight
          // Nour's pin intent).
          const isMainRow = idx >= pinnedRows.length;
          const showKindHeader =
            showKindSections &&
            isMainRow &&
            kindFilter === "all" &&
            kind !== prevMainKind;
          // 2026-05-23 · task #20 · status section header. Same gates
          // as the kind header except keyed off task.status. No
          // kindFilter gate — status grouping is its own axis and the
          // operator already explicitly selected sortKey "by-status".
          const showStatusHeader =
            showStatusSections &&
            isMainRow &&
            task.status !== prevMainStatus;
          if (isMainRow) {
            prevMainKind = kind;
            prevMainStatus = task.status;
          }
          // 2026-05-23 · task #19 · sticky · the eyebrow pins to the
          // top of the scroll container so the operator always knows
          // which cluster the rows below belong to. `bg-[var(--bg-base)]`
          // (#0A0A0A — the page background) masks row content scrolling
          // under it · `z-10` sits above rows but below modals/menus ·
          // `top-0` sticks to the page scroll container (no fixed app
          // shell to offset against).
          const sectionHeader = showKindHeader ? (
            <div
              key={`section-kind-${kind}-${idx}`}
              className="sticky top-0 z-10 flex items-center gap-1.5 px-2 pt-2 pb-1 text-[8px] font-mono uppercase tracking-wider text-zinc-600 bg-[var(--bg-base)]/95 backdrop-blur-sm"
              // 2026-05-24 · Wave U ux-F12 · pre-fix aria-hidden hid
              // real structural cue from VoiceOver · screen-reader
              // operator heard a flat list with no grouping. Now: role
              // + aria-level expose the section heading so VoiceOver
              // announces "doing, heading level 3" before each cluster.
              role="heading"
              aria-level={3}
            >
              <KindIcon kind={kind} size={8} />
              <span>{kind === "DAILY" ? "daily · habits" : kind === "PROMISE" ? "promises" : "once · tasks"}</span>
              <div className="flex-1 h-px bg-zinc-800/40" />
            </div>
          ) : showStatusHeader ? (
            // 2026-05-23 · task #20 · status section header · same
            // editorial-minimalist eyebrow as the kind header, only the
            // label vocabulary changes. No KindIcon — status doesn't
            // have a clean glyph and a colored dot would noise the row.
            <div
              key={`section-status-${task.status}-${idx}`}
              className="sticky top-0 z-10 flex items-center gap-1.5 px-2 pt-2 pb-1 text-[8px] font-mono uppercase tracking-wider text-zinc-600 bg-[var(--bg-base)]/95 backdrop-blur-sm"
              // 2026-05-24 · Wave U ux-F12 · pre-fix aria-hidden hid
              // real structural cue from VoiceOver · screen-reader
              // operator heard a flat list with no grouping. Now: role
              // + aria-level expose the section heading so VoiceOver
              // announces "doing, heading level 3" before each cluster.
              role="heading"
              aria-level={3}
            >
              <span>
                {STATUS_HEADER_LABEL[task.status] ?? task.status.toLowerCase()}
              </span>
              <div className="flex-1 h-px bg-zinc-800/40" />
            </div>
          ) : null;
          const fit = classifyFit(task, liveSignals);
          const checked = selectedIds.has(task.id);
          // 2026-05-23 · task #22 · ADR-0017 Rule 3 + Rule 4. Children
          // (rows where task.parentTaskId is set) render at indent 1.
          // The UI never goes beyond 1 · grand-children (operator
          // raw-SQL bypass) degrade to indent 1 too so they still
          // render as direct children visually.
          const indentLevel = task.parentTaskId ? 1 : 0;
          const childCount = childCountByParent.get(task.id) ?? null;
          // 2026-05-24 · Wave U feature-mining #5 · pass done count
          // alongside total · parent row chip now reads "+3 sub ·
          // 1/3 done" so the operator answers "where am I on this"
          // without expanding.
          const doneChildCount = doneChildCountByParent.get(task.id) ?? 0;
          const rowItem = (
            <LoopRowItem
              task={task}
              kind={kind}
              urgency={urgency}
              overdue={overdue}
              doneToday={doneToday}
              daysUntilDeadline={daysUntilDeadline}
              doneChildCount={doneChildCount}
              isPinned={pinnedIds?.has(task.id) ?? false}
              indentLevel={indentLevel}
              childCount={childCount}
              onAddSubtask={onAddSubtask}
              isCompleting={completingIds.has(task.id)}
              isExpanded={expandedId === task.id}
              isEditing={editingId === task.id}
              isSnoozing={snoozingId === task.id}
              isDecideOpen={decideId === task.id}
              isDomainEditing={domainEditId === task.id}
              isDragging={draggingId === task.id}
              isDragOver={dragOverId === task.id && draggingId !== task.id}
              decidePendingMode={decideId === task.id ? pendingMode : null}
              editTitle={editTitle}
              editAction={editAction}
              editEffort={editEffort}
              editDueDate={editDueDate}
              reframeText={reframeText}
              blockerText={blockerText}
              domainSwapBusy={domainSwapBusy}
              isReviewBusy={review.busyId === task.id}
              customDomainOptions={customDomainOptions}
              goalLineage={goalLineage}
              fit={fit}
              onComplete={onRowComplete}
              onDelete={onDelete}
              onStart={onStart}
              onPin={onPin}
              onBreakPromise={onBreakPromise}
              onEditTaskGoal={onEditTaskGoal}
              onEditTaskMission={onEditTaskMission}
              onToggleExpand={toggleExpand}
              onOpenEditFromRow={onOpenEditFromRow}
              onChangeEditTitle={setEditTitle}
              onChangeEditAction={setEditAction}
              onChangeEditEffort={setEditEffort}
              onChangeEditDueDate={setEditDueDate}
              onSaveEdit={onSaveEdit}
              onCancelEdit={onCancelEdit}
              onOpenDecide={onOpenDecide}
              onCancelDecide={onCancelDecide}
              onSetDecideMode={onSetDecideMode}
              onChangeReframeText={setReframeText}
              onChangeBlockerText={setBlockerText}
              onCommitKill={onCommitKill}
              onCommitReframe={onCommitReframe}
              onCommitBlocker={onCommitBlocker}
              onOpenSnooze={onOpenSnooze}
              onCancelSnooze={onCancelSnooze}
              onCommitSnooze={onCommitSnooze}
              onOpenDomainEdit={onOpenDomainEdit}
              onCancelDomainEdit={onCancelDomainEdit}
              onCommitDomainSwap={onCommitDomainSwap}
              onOpenBreakModal={onOpenBreakModal}
              onOpenEditFromPanel={onOpenEditFromPanel}
              onCollapse={onCollapse}
              onDragStart={onRowDragStart}
              onDragEnd={onRowDragEnd}
              onDragOver={onRowDragOver}
              onDragLeave={onRowDragLeave}
              onDrop={onRowDrop}
            />
          );
          const rowWrap = !selectMode ? (
            <div key={task.id}>{rowItem}</div>
          ) : (
            <div key={task.id} className="flex items-start gap-2">
              <button type="button" role="checkbox" aria-checked={checked} aria-label={`Select ${task.title}`} onClick={() => toggleSelect(task.id)} className={cn("mt-2 shrink-0 w-7 h-7 grid place-items-center rounded border transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gold)]/60", checked ? "bg-[var(--gold)]/15 border-[var(--gold)]/60 text-[var(--gold)]" : "border-zinc-700/60 text-transparent hover:border-zinc-500")}>
                <Check size={14} strokeWidth={3} />
              </button>
              <div className="flex-1 min-w-0">{rowItem}</div>
            </div>
          );
          // 2026-05-23 · React accepts array-of-children inside a
          // map slot; each entry needs its own key. Filter the null
          // header so a non-rendering header doesn't leave a hole.
          return sectionHeader ? [sectionHeader, rowWrap] : rowWrap;
        });
        })()}
      </div>

      {/* v10.0.530 · BULK-SELECT sticky action bar. Sequential awaits
          on existing per-id handlers — no new bulk endpoints yet. */}
      {selectMode && selectedIds.size > 0 && (() => {
        const btn = "text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded disabled:opacity-40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gold)]/60";
        return (
          <div role="toolbar" aria-label="Bulk actions" className="sticky bottom-2 z-20 flex items-center gap-1.5 rounded-lg border border-[var(--gold)]/40 bg-zinc-950/95 backdrop-blur px-2.5 py-1.5 shadow-lg">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--gold)] mr-1">{selectedIds.size}</span>
            <button type="button" disabled={bulkBusy} onClick={() => void runBulk(onComplete)} className={cn(btn, "text-emerald-300 hover:bg-emerald-500/10")}>done</button>
            <button type="button" disabled={bulkBusy} onClick={() => void bulkSnooze()} className={cn(btn, "text-zinc-300 hover:bg-zinc-800")}>snooze · tomorrow</button>
            <button type="button" disabled={bulkBusy} onClick={() => void bulkDelete()} className={cn(btn, "text-red-400 hover:bg-red-500/10")}>delete</button>
            <button type="button" disabled={bulkBusy} onClick={exitSelect} className={cn(btn, "ml-auto text-zinc-500 hover:text-zinc-300")}>cancel</button>
            {bulkBusy && <Loader2 size={12} className="animate-spin text-[var(--gold)]" />}
          </div>
        );
      })()}
    </div>
  );
}

// ─── Shared helper export: break-promise modal sub-component ───
// This used to live inline in LoopStream but got extracted so the
// main component stays readable. Still a private non-exported helper.
