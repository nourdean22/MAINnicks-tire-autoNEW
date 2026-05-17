"use client";

/**
 * LoopRowItem — single-row child of LoopStream.
 *
 * Extracted from loop-stream.tsx (v10.0.529.14) as the #1 perf win
 * surfaced by the /tasks audit. Pre-extraction the row body was ~900
 * LOC of inline JSX inside LoopStream's .map((row) => ...), which
 * re-evaluated on every parent state tick (completingIds, draggingId,
 * editingId, snoozingId, decideId, domainEditId, …). With this
 * component memoized via React.memo and the parent passing per-row
 * BOOLEANS (derived from Sets/IDs at the parent level) plus stable
 * useCallback'd handlers, a single-row interaction (e.g. opening an
 * inline edit on row 3) no longer cascades to a re-render of every
 * other row.
 *
 * Design notes:
 *   · All state owned by the parent — this component is presentational
 *     for STATE, but it OWNS the row's drag listeners, click handlers,
 *     and DOM. Lifting state up keeps shared concerns (decide / snooze
 *     / edit / drag) coherent across the list.
 *   · Per-row booleans (`isExpanded`, `isEditing`, etc.) are computed
 *     by the parent before passing — the parent's Sets/IDs never cross
 *     the memo boundary, only primitive values.
 *   · Edit form's text values are passed as props + change handlers;
 *     this keeps a single source of truth in the parent and avoids
 *     a stale-closure trap.
 *   · `KindIcon` and `computeWhyLine` are exported back for re-use by
 *     the hero card in the parent (same visual treatment as a row).
 *
 * Visual + behavior contract: 100% IDENTICAL to the pre-extraction
 * inline JSX. No aesthetic shifts, no UX shifts. Only owner identity
 * shifts (now lives in a memoized child instead of an inline closure).
 */

import { memo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  Circle,
  Flame,
  Handshake,
  Target,
  Clock,
  Trash2,
  Pin,
  Zap,
  X,
  Skull,
  Edit3,
  Hourglass,
  Loader2,
  GripVertical,
  Briefcase,
} from "lucide-react";
import {
  domainClass,
  ageLabel as ag,
  daysSince as ds,
  EFFORT_LABEL as EFF,
  originSourceLabel,
  type Task,
  type LoopKind,
} from "@/components/actions/shared";
import { EventTimeline } from "@/components/actions/event-timeline";

/**
 * Apr 26 · F5 — One-line "why is this #1" reason for the Next Move
 * hero card. Pulled from the row's already-computed urgency signals
 * + the task's own fields. Returns null when there's nothing
 * non-obvious to add (the lineage breadcrumb is already there).
 *
 * Priority order (first match wins):
 *   · PROMISE overdue → "Nd overdue · @<person>"
 *   · stale 14d+      → "stale Nd · was a yes, now drifting"
 *   · DAILY streak    → "Streak day N · protect the chain"
 *   · stale 7-14d     → "stale Nd · do or kill"
 *   · short effort    → "quick win · 5m"
 *   · high ROI signal → "high-ROI · low-friction"
 *
 * Returns the string or null. Caller renders under the lineage line.
 */
export function computeWhyLine(args: {
  task: Task;
  kind: LoopKind;
  ageDays: number;
  daysUntilDeadline: number | null;
  overdue: boolean;
}): string | null {
  const { task, kind, ageDays, daysUntilDeadline, overdue } = args;

  // PROMISE — deadline is the strongest stake
  if (kind === "PROMISE" && overdue && daysUntilDeadline !== null) {
    const who = task.promiseTo ? ` · @${task.promiseTo}` : "";
    return `${Math.abs(daysUntilDeadline)}d overdue${who} · ship it or break it cleanly`;
  }
  if (kind === "PROMISE" && daysUntilDeadline !== null && daysUntilDeadline <= 1) {
    const who = task.promiseTo ? ` · @${task.promiseTo}` : "";
    const when = daysUntilDeadline === 0 ? "due today" : "due tomorrow";
    return `${when}${who} · don't let it become a broken promise`;
  }

  // DAILY streak — protecting momentum is a real reason
  if (kind === "DAILY" && (task.streakCount ?? 0) >= 3) {
    return `Streak day ${task.streakCount} · breaking it costs more than doing it`;
  }

  // ONCE — staleness is the strongest signal we have without TaskEvents
  if (kind === "ONCE" && ageDays >= 21) {
    return `${ageDays}d untouched · was a yes, now drifting — pick or kill`;
  }
  if (kind === "ONCE" && ageDays >= 14) {
    return `${ageDays}d untouched · momentum decay is real`;
  }
  if (kind === "ONCE" && ageDays >= 7) {
    return `${ageDays}d untouched · do today or reframe smaller`;
  }

  // Quick wins — sub-15m tasks should highlight that
  if (task.effort === "M5" || task.effort === "M15") {
    return task.effort === "M5"
      ? "quick win · 5min · clear it now"
      : "quick win · 15min · low cost to start";
  }

  // High-effort task — surface the trade-off
  if (task.effort === "H2PLUS" || task.effort === "H4" || task.effort === "H8") {
    return "deep block · clear other noise first";
  }

  return null;
}

/**
 * Kind icon used in each row — single consistent glyph per kind so
 * Nour can eyeball what type every item is without reading.
 */
export function KindIcon({ kind, size = 12 }: { kind: LoopKind; size?: number }) {
  if (kind === "DAILY") return <Flame size={size} className="text-amber-400/70" />;
  if (kind === "PROMISE") return <Handshake size={size} className="text-violet-400/70" />;
  return <Target size={size} className="text-blue-400/70" />;
}

// ─── LoopRowItem ────────────────────────────────────────────────────

type LoopRowFit = "fits-now" | "save-morning" | "wrong-moment" | "neutral";

export interface LoopRowItemProps {
  /** The task + computed metadata for this single row. */
  task: Task;
  kind: LoopKind;
  urgency: number;
  overdue: boolean;
  doneToday: boolean;
  daysUntilDeadline: number | null;

  /** Sibling pin metadata — read-only here. */
  isPinned: boolean;

  /** Per-row state booleans derived from parent Sets/IDs. */
  isCompleting: boolean;
  isExpanded: boolean;
  isEditing: boolean;
  isSnoozing: boolean;
  isDecideOpen: boolean;
  isDomainEditing: boolean;
  isDragging: boolean;
  isDragOver: boolean;

  /** Decide submode — only meaningful when `isDecideOpen`. */
  decidePendingMode: "reframe" | "blocker" | null;

  /** Edit form text values — only meaningful when `isEditing`. */
  editTitle: string;
  editAction: string;
  editEffort: string;
  editDueDate: string;

  /** Decide form text values — only meaningful when `isDecideOpen`. */
  reframeText: string;
  blockerText: string;

  /** Domain swap in flight — disables the picker buttons. */
  domainSwapBusy: boolean;

  /** True when review actions hook is busy on THIS task. */
  isReviewBusy: boolean;

  /** Custom domains list from useCustomDomains hook (parent). */
  customDomainOptions: string[];

  /** Goal lineage map for the breadcrumb chip. */
  goalLineage?: Map<string, { title: string; horizon?: string; domain?: string; paceKind?: string }>;

  /** F6 fit verdict for this row (already classified by parent). */
  fit: LoopRowFit;

  /** Apr 26 · F11 — optimistic spinner wrapper for complete. */
  onComplete: (id: string) => void;

  /** Pass-through external handlers — same identity as parent props. */
  onDelete: (id: string) => void | Promise<void>;
  onStart?: (id: string) => void | Promise<void>;
  onPin?: (id: string) => void;
  onBreakPromise?: (id: string, reason: string) => void | Promise<void>;
  onEditTaskGoal?: (taskId: string) => void;
  onEditTaskMission?: (taskId: string) => void;

  /** Title tap toggles the expanded panel. */
  onToggleExpand: (id: string) => void;

  /** Rename button on the collapsed row (opens edit mode + expands). */
  onOpenEditFromRow: (task: Task) => void;

  /** Edit panel field changes. */
  onChangeEditTitle: (v: string) => void;
  onChangeEditAction: (v: string) => void;
  onChangeEditEffort: (v: string) => void;
  onChangeEditDueDate: (v: string) => void;

  /** Edit panel save / cancel. */
  onSaveEdit: (task: Task) => void;
  onCancelEdit: () => void;

  /** Stale-chip → opens decide panel; cancel closes it. */
  onOpenDecide: (task: Task) => void;
  onCancelDecide: () => void;
  onSetDecideMode: (mode: "reframe" | "blocker" | null) => void;
  onChangeReframeText: (v: string) => void;
  onChangeBlockerText: (v: string) => void;
  onCommitKill: (taskId: string) => void;
  onCommitReframe: (taskId: string, title: string) => void;
  onCommitBlocker: (taskId: string, waitingOn: string) => void;

  /** Snooze popover. */
  onOpenSnooze: (taskId: string) => void;
  onCancelSnooze: () => void;
  onCommitSnooze: (taskId: string, days: number) => void;

  /** Domain picker. */
  onOpenDomainEdit: (taskId: string) => void;
  onCancelDomainEdit: () => void;
  onCommitDomainSwap: (taskId: string, domain: string) => void;

  /** Break promise modal launcher. */
  onOpenBreakModal: (taskId: string, title: string) => void;

  /** Open the edit panel (from the in-panel "edit" button). */
  onOpenEditFromPanel: (task: Task) => void;

  /** Collapse the expanded panel. */
  onCollapse: () => void;

  /** Drag handlers — receive ids/urgency, parent owns the Set state. */
  onDragStart: (taskId: string, e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onDragOver: (taskId: string, e: React.DragEvent<HTMLDivElement>) => void;
  onDragLeave: (taskId: string) => void;
  onDrop: (taskId: string, urgency: number, e: React.DragEvent<HTMLDivElement>) => void;
}

function LoopRowItemImpl(props: LoopRowItemProps) {
  const {
    task,
    kind,
    urgency,
    overdue,
    doneToday,
    daysUntilDeadline,
    isPinned,
    isCompleting,
    isExpanded,
    isEditing,
    isSnoozing,
    isDecideOpen,
    isDomainEditing,
    isDragging,
    isDragOver,
    decidePendingMode,
    editTitle,
    editAction,
    editEffort,
    editDueDate,
    reframeText,
    blockerText,
    domainSwapBusy,
    isReviewBusy,
    customDomainOptions,
    goalLineage,
    fit,
    onComplete,
    onDelete,
    onStart,
    onPin,
    onBreakPromise,
    onEditTaskGoal,
    onEditTaskMission,
    onToggleExpand,
    onOpenEditFromRow,
    onChangeEditTitle,
    onChangeEditAction,
    onChangeEditEffort,
    onChangeEditDueDate,
    onSaveEdit,
    onCancelEdit,
    onOpenDecide,
    onCancelDecide,
    onSetDecideMode,
    onChangeReframeText,
    onChangeBlockerText,
    onCommitKill,
    onCommitReframe,
    onCommitBlocker,
    onOpenSnooze,
    onCancelSnooze,
    onCommitSnooze,
    onOpenDomainEdit,
    onCancelDomainEdit,
    onCommitDomainSwap,
    onOpenBreakModal,
    onOpenEditFromPanel,
    onCollapse,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDragLeave,
    onDrop,
  } = props;

  // v10.0.529.19 · F12 mobile swipe gestures · right=complete, left=snooze.
  // Thresholds: 60px horizontal travel · 400ms time budget · |dx|/|dy| > 1.5
  // to ignore vertical scrolls. Transform-only translateX during the gesture
  // (no layout thrash). Touch only — desktop HTML5 drag is untouched.
  const swipeStart = useRef<{ x: number; y: number; t: number } | null>(null);
  const swipeFired = useRef(false);
  const [swipeDx, setSwipeDx] = useState(0);
  const onTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const t = e.touches[0];
    swipeStart.current = { x: t.clientX, y: t.clientY, t: Date.now() };
    swipeFired.current = false;
  };
  const onTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!swipeStart.current) return;
    const t = e.touches[0];
    const dx = t.clientX - swipeStart.current.x;
    const dy = t.clientY - swipeStart.current.y;
    if (Math.abs(dx) > Math.abs(dy) * 1.5) setSwipeDx(dx);
  };
  const onTouchEnd = () => {
    const s = swipeStart.current;
    swipeStart.current = null;
    const dx = swipeDx;
    setSwipeDx(0);
    if (!s) return;
    const elapsed = Date.now() - s.t;
    if (elapsed > 400 || Math.abs(dx) < 60) return;
    swipeFired.current = true;
    if (dx > 0) onComplete(task.id);
    else onOpenSnooze(task.id);
  };
  const swipeOpacity = Math.min(Math.abs(swipeDx) / 60, 1);

  const isDoing = task.status === "DOING";
  // Stale glow: ONCE loops sitting in INBOX > 7 days with no
  // activity. We use createdAt as the reference because that
  // captures "how long since I decided this was worth doing"
  // better than updatedAt (which ticks on any edit).
  const ageDays = ds(task.createdAt);
  const isStale =
    kind === "ONCE" &&
    task.status === "INBOX" &&
    ageDays > 7;

  return (
    <div
      id={`task-row-${task.id}`}
      draggable
      onDragStart={(e) => onDragStart(task.id, e)}
      onDragEnd={onDragEnd}
      onDragOver={(e) => onDragOver(task.id, e)}
      onDragLeave={() => onDragLeave(task.id)}
      onDrop={(e) => onDrop(task.id, urgency, e)}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onClickCapture={(e) => {
        if (swipeFired.current) {
          e.stopPropagation();
          e.preventDefault();
          swipeFired.current = false;
        }
      }}
      aria-label="Swipe right to complete, swipe left to snooze"
      style={{
        transform: swipeDx ? `translateX(${swipeDx}px)` : undefined,
        willChange: swipeDx ? "transform" : undefined,
      }}
      className={cn(
        "group relative flex items-start gap-2 py-1.5 px-2 rounded-lg transition-colors",
        isDoing && "bg-blue-500/5 border-l-2 border-blue-500/40",
        doneToday && "opacity-45",
        overdue && "bg-red-500/5",
        isStale && !overdue && "bg-amber-500/[0.03] border-l-2 border-amber-500/20",
        // Apr 26 · F6 — wrong-moment rows desaturate so they
        // visually fall back without disappearing. Helps Nour's
        // eye skip past tasks that don't fit the current state.
        fit === "wrong-moment" && !isDoing && !overdue && "opacity-50",
        // Apr 26 · F10 — drag visual states
        isDragging && "opacity-30",
        isDragOver && "ring-2 ring-amber-400/60 bg-amber-500/[0.05]",
        !isDoing && !overdue && !isStale && "hover:bg-zinc-900/40"
      )}
    >
      {/* v10.0.529.19 · F12 swipe-direction hint edges. Gold = right (complete),
          rose = left (snooze). Opacity scales with travel · pointer-events none
          so they never block the underlying tap targets. */}
      {swipeDx > 0 && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 w-1 rounded-r-lg bg-amber-400"
          style={{ opacity: swipeOpacity }}
        />
      )}
      {swipeDx < 0 && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-1 rounded-l-lg bg-rose-400"
          style={{ opacity: swipeOpacity }}
        />
      )}
      <button
        onClick={() => onComplete(task.id)}
        disabled={isCompleting}
        className={cn(
          "mt-0.5 shrink-0 transition-colors",
          isCompleting
            ? "text-emerald-400"
            : doneToday
              ? "text-emerald-500/60"
              : "text-zinc-600 hover:text-emerald-400"
        )}
        aria-label="Complete"
      >
        {isCompleting ? (
          <Loader2 size={13} className="animate-spin" />
        ) : doneToday ? (
          <CheckCircle2 size={13} />
        ) : (
          <Circle size={13} />
        )}
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <KindIcon kind={kind} size={10} />
          {/* Apr 26 · F7 — title is now a tap target. Clicking
              toggles the expanded detail panel below the row.
              Other in-row buttons (stale chip, complete) stop
              propagation so they don't cross-trigger expand. */}
          <button
            type="button"
            onClick={() => onToggleExpand(task.id)}
            className={cn(
              "text-[12px] text-zinc-200 flex-1 min-w-0 truncate text-left hover:text-amber-300 transition-colors cursor-pointer",
              doneToday && "line-through text-zinc-600"
            )}
            aria-expanded={isExpanded}
            aria-label="Toggle task details"
          >
            {task.title}
          </button>
          {/* v10.0.421 · quick-rename · operator can edit title from the
              collapsed row · skips the expand → "edit" two-step. Always
              visible on mobile (44px target) · hover-only on desktop. */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenEditFromRow(task);
            }}
            className="shrink-0 w-11 h-11 sm:w-6 sm:h-6 rounded sm:rounded-sm flex items-center justify-center text-zinc-600 hover:text-amber-400 hover:bg-zinc-800/50 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
            title="Rename task"
            aria-label="Rename task"
          >
            <Edit3 size={12} className="sm:w-3 sm:h-3" />
          </button>
          {kind === "DAILY" && (task.streakCount ?? 0) > 0 && (
            <span className="text-[9px] text-amber-400 font-mono shrink-0">
              🔥{task.streakCount}
            </span>
          )}
          {isStale && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (isDecideOpen) {
                  onCancelDecide();
                } else {
                  onOpenDecide(task);
                }
              }}
              className={cn(
                "text-[8px] font-mono shrink-0 uppercase tracking-wider transition-colors px-1.5 py-0.5 rounded border",
                isDecideOpen
                  ? "text-amber-300 bg-amber-500/15 border-amber-500/40"
                  : "text-amber-500/80 border-amber-500/20 hover:bg-amber-500/10"
              )}
              title="Decide: kill / reframe / blocker"
            >
              stale {ageDays}d
            </button>
          )}
          {kind === "PROMISE" && daysUntilDeadline !== null && (
            <span
              className={cn(
                "text-[9px] font-mono shrink-0",
                overdue
                  ? "text-red-400"
                  : daysUntilDeadline === 0
                    ? "text-amber-400"
                    : daysUntilDeadline <= 2
                      ? "text-amber-400"
                      : "text-zinc-600"
              )}
            >
              {overdue
                ? `${Math.abs(daysUntilDeadline)}d late`
                : daysUntilDeadline === 0
                  ? "today"
                  : `${daysUntilDeadline}d`}
            </span>
          )}
          {task.effort && (
            <span className="text-[8px] text-zinc-700 font-mono shrink-0">
              {EFF[task.effort] || task.effort}
            </span>
          )}
          {/* Apr 26 · F6 — fit chip. Only renders when the
              answer is non-neutral so it doesn't add noise on
              every row. Tap-target so Nour can read the why
              via title attribute on hover/long-press. */}
          {fit === "fits-now" && !isDoing && !doneToday && (
            <span
              title="Energy + state match · short enough to fit"
              className="text-[8px] text-emerald-400 font-mono shrink-0 px-1 rounded bg-emerald-500/10 border border-emerald-500/20"
            >
              now
            </span>
          )}
          {fit === "save-morning" && !isDoing && !doneToday && (
            <span
              title="High energy demand or wouldn't fit remaining capacity — save for a fresher slot"
              className="text-[8px] text-zinc-500 font-mono shrink-0 px-1 rounded bg-zinc-800/50 border border-zinc-700"
            >
              morning
            </span>
          )}
          {fit === "wrong-moment" && !isDoing && !doneToday && (
            <span
              title="Heavy task while state is drifting — wrong moment"
              className="text-[8px] text-rose-400/70 font-mono shrink-0 px-1 rounded bg-rose-500/5 border border-rose-500/20"
            >
              wrong moment
            </span>
          )}
          {task.mission?.domain && (
            <Badge className={cn("h-3 text-[7px] border-0 shrink-0", domainClass(task.mission.domain))}>
              {task.mission.domain.toLowerCase().slice(0, 3)}
            </Badge>
          )}
          {/* Apr 26 · F5 — origin-source chip. Only renders
              when source maps to a non-default label. Manual
              page-add tasks intentionally show no chip so
              the row stays clean. */}
          {(() => {
            const label = originSourceLabel(task.originSource);
            if (!label) return null;
            return (
              <span
                title={`Created via ${task.originSource}`}
                className="text-[7px] uppercase tracking-wider font-mono shrink-0 px-1 rounded bg-zinc-800/40 text-zinc-500 border border-zinc-700/40"
              >
                {label}
              </span>
            );
          })()}
        </div>
        {kind === "PROMISE" && task.promiseTo && (
          <p className="text-[9px] text-violet-400/70 mt-0.5">promised to {task.promiseTo}</p>
        )}
        {kind === "ONCE" && task.nextPhysicalAction && task.nextPhysicalAction !== task.title && (
          <p className="text-[9px] text-zinc-600 mt-0.5 truncate">→ {task.nextPhysicalAction}</p>
        )}

        {/* Apr 26 · F3 — inline 3-button decide row when the
            stale chip on this row has been tapped. Reframe +
            blocker reveal text inputs nested under their pill.
            Clicking outside (or another stale chip) collapses. */}
        {isDecideOpen && (
          <div className="mt-1.5 space-y-1.5">
            {decidePendingMode === "reframe" ? (
              <div className="flex gap-1.5">
                <input
                  autoFocus
                  value={reframeText}
                  onChange={(e) => onChangeReframeText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && reframeText.trim()) {
                      onCommitReframe(task.id, reframeText.trim());
                    } else if (e.key === "Escape") {
                      onSetDecideMode(null);
                    }
                  }}
                  placeholder="Smaller next action…"
                  className="flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-200 outline-none focus:border-amber-500/40"
                />
                <button
                  onClick={() => {
                    if (!reframeText.trim()) return;
                    onCommitReframe(task.id, reframeText.trim());
                  }}
                  disabled={!reframeText.trim() || isReviewBusy}
                  className="rounded-md bg-amber-500 px-2 text-[10px] font-medium text-black hover:bg-amber-400 disabled:opacity-50"
                >
                  save
                </button>
              </div>
            ) : decidePendingMode === "blocker" ? (
              <div className="flex gap-1.5">
                <input
                  autoFocus
                  value={blockerText}
                  onChange={(e) => onChangeBlockerText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && blockerText.trim()) {
                      onCommitBlocker(task.id, blockerText.trim());
                    } else if (e.key === "Escape") {
                      onSetDecideMode(null);
                    }
                  }}
                  placeholder="Waiting on…"
                  className="flex-1 rounded-md border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-200 outline-none focus:border-sky-500/40"
                />
                <button
                  onClick={() => {
                    if (!blockerText.trim()) return;
                    onCommitBlocker(task.id, blockerText.trim());
                  }}
                  disabled={!blockerText.trim() || isReviewBusy}
                  className="rounded-md bg-sky-500 px-2 text-[10px] font-medium text-black hover:bg-sky-400 disabled:opacity-50"
                >
                  save
                </button>
              </div>
            ) : (
              <div className="flex gap-1.5">
                <button
                  onClick={() => onCommitKill(task.id)}
                  disabled={isReviewBusy}
                  className="inline-flex items-center gap-1 rounded-md border border-rose-500/30 px-2 py-0.5 text-[10px] font-medium text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"
                >
                  {isReviewBusy ? (
                    <Loader2 size={10} className="animate-spin" />
                  ) : (
                    <Skull size={10} />
                  )}
                  kill
                </button>
                <button
                  onClick={() => onSetDecideMode("reframe")}
                  className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 px-2 py-0.5 text-[10px] font-medium text-amber-300 hover:bg-amber-500/10"
                >
                  <Edit3 size={10} />
                  reframe
                </button>
                <button
                  onClick={() => onSetDecideMode("blocker")}
                  className="inline-flex items-center gap-1 rounded-md border border-sky-500/30 px-2 py-0.5 text-[10px] font-medium text-sky-300 hover:bg-sky-500/10"
                >
                  <Hourglass size={10} />
                  blocker
                </button>
                <button
                  onClick={onCancelDecide}
                  className="inline-flex items-center gap-1 rounded-md border border-zinc-800 px-2 py-0.5 text-[10px] font-medium text-zinc-500 hover:bg-zinc-900"
                >
                  cancel
                </button>
              </div>
            )}
          </div>
        )}

        {/* Apr 27 · GB5 — sharper goal chip on NOW rows.
            Replaces the muted gray breadcrumb with a colored
            pill (purple = goal, amber = mission fallback) so
            the goal-task linkage is visually obvious. Tells
            Nour at a glance "completing this lifts that goal."
            Falls back to mission-only when no goal is linked. */}
        {task.goalId && goalLineage?.get(task.goalId) ? (
          <div className="mt-0.5 flex items-center gap-1 flex-wrap">
            <span
              className="inline-flex items-center gap-1 rounded border border-violet-500/30 bg-violet-500/5 px-1 py-0.5 text-[8px] font-mono uppercase tracking-wider text-violet-300 max-w-full"
              title="Completing this task auto-lifts this goal"
            >
              <Target size={8} className="shrink-0" />
              <span className="truncate">
                {goalLineage.get(task.goalId)!.title}
              </span>
              {goalLineage.get(task.goalId)!.horizon && (
                <span className="text-violet-400/60 shrink-0">
                  · {goalLineage.get(task.goalId)!.horizon}
                </span>
              )}
            </span>
            {/* Apr 27 · goal pace urgency chip. When the
                linked goal is behind/missed/needs, paint
                a small urgency tag so the row visually
                signals "this matters more than its
                autoPriority alone says." */}
            {(() => {
              const pk = goalLineage.get(task.goalId!)!.paceKind;
              if (pk === "missed") {
                return (
                  <span
                    title="Linked goal's deadline has passed unmet — completing this still logs progress"
                    className="inline-flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/10 px-1 py-0.5 text-[8px] font-mono uppercase tracking-wider text-rose-300"
                  >
                    goal missed
                  </span>
                );
              }
              if (pk === "behind") {
                return (
                  <span
                    title="Linked goal is behind pace — finishing this lifts it"
                    className="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1 py-0.5 text-[8px] font-mono uppercase tracking-wider text-amber-300"
                  >
                    goal behind
                  </span>
                );
              }
              if (pk === "needs") {
                return (
                  <span
                    title="Linked goal needs daily progress — finishing this lifts it"
                    className="inline-flex items-center gap-1 rounded border border-sky-500/40 bg-sky-500/10 px-1 py-0.5 text-[8px] font-mono uppercase tracking-wider text-sky-300"
                  >
                    goal needs +1
                  </span>
                );
              }
              return null;
            })()}
          </div>
        ) : task.mission?.title && task.mission.title !== "Inbox" ? (
          <p className="text-[9px] text-zinc-700 mt-0.5 truncate">
            ↳ {task.mission.title}
          </p>
        ) : null}

        {/* ── ACTUAL MINUTES — shows when non-zero. Gives
            Nour feedback on how long things really take so
            his effort estimates calibrate over time. ── */}
        {(task.actualMinutes ?? 0) > 0 && (
          <p className="text-[8px] text-zinc-700 mt-0.5 font-mono">
            ⏱ {task.actualMinutes}m actual
          </p>
        )}

        {/* Apr 26 · F7 — Expanded detail panel. Tap title to
            toggle. Shows full title (no truncate), finish
            condition, the WHY line, all metadata in a tight
            grid, plus primary action buttons. */}
        {isExpanded && isEditing && (
          <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/[0.03] p-2 space-y-2">
            <div className="flex items-center gap-2">
              <Edit3 size={11} className="text-amber-400 shrink-0" />
              <span className="text-[9px] uppercase tracking-wider text-amber-400 font-mono">
                editing
              </span>
            </div>
            <div className="space-y-1.5">
              <label className="block">
                <span className="block text-[8px] uppercase tracking-wider text-zinc-600 font-mono mb-0.5">title</span>
                <input
                  autoFocus
                  value={editTitle}
                  onChange={(e) => onChangeEditTitle(e.target.value)}
                  className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-[12px] text-zinc-200 outline-none focus:border-amber-500/40"
                />
              </label>
              <label className="block">
                <span className="block text-[8px] uppercase tracking-wider text-zinc-600 font-mono mb-0.5">next physical action</span>
                <input
                  value={editAction}
                  onChange={(e) => onChangeEditAction(e.target.value)}
                  className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 outline-none focus:border-amber-500/40"
                  placeholder="e.g. Call doctor, schedule blood draw"
                />
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                <label className="block">
                  <span className="block text-[8px] uppercase tracking-wider text-zinc-600 font-mono mb-0.5">effort</span>
                  <select
                    value={editEffort}
                    onChange={(e) => onChangeEditEffort(e.target.value)}
                    className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 outline-none focus:border-amber-500/40"
                  >
                    {(["M5", "M15", "M30", "H1", "H2PLUS"] as const).map((eff) => (
                      <option key={eff} value={eff}>{EFF[eff] || eff}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="block text-[8px] uppercase tracking-wider text-zinc-600 font-mono mb-0.5">due</span>
                  <input
                    type="date"
                    value={editDueDate}
                    onChange={(e) => onChangeEditDueDate(e.target.value)}
                    className="w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 outline-none focus:border-amber-500/40"
                  />
                </label>
              </div>
            </div>
            <div className="flex items-center gap-1.5 pt-1 border-t border-zinc-900">
              <button
                type="button"
                onClick={() => onSaveEdit(task)}
                disabled={isReviewBusy || !editTitle.trim()}
                className="inline-flex items-center gap-1 rounded-md bg-amber-500 px-3 py-1 text-[11px] font-medium text-black hover:bg-amber-400 disabled:opacity-50"
              >
                {isReviewBusy ? <Loader2 size={11} className="animate-spin" /> : null}
                save
              </button>
              <button
                type="button"
                onClick={onCancelEdit}
                className="inline-flex items-center gap-1 rounded-md border border-zinc-800 px-2 py-1 text-[11px] text-zinc-500 hover:text-zinc-300"
              >
                cancel
              </button>
            </div>
          </div>
        )}
        {isExpanded && !isEditing && (
          <div className="mt-2 rounded-md border border-zinc-800/60 bg-zinc-950/40 p-2 space-y-2">
            {/* Full title (no truncate) */}
            {task.title.length > 50 && (
              <p className="text-[12px] text-zinc-200 font-medium leading-snug">
                {task.title}
              </p>
            )}

            {/* WHY line — same heuristic as the hero card */}
            {(() => {
              const why = computeWhyLine({
                task,
                kind,
                ageDays,
                daysUntilDeadline,
                overdue,
              });
              if (!why) return null;
              return (
                <p className="text-[10px] text-amber-400/80 italic flex items-start gap-1.5">
                  <span className="text-amber-500/50 font-mono uppercase tracking-wider text-[8px] not-italic shrink-0 mt-0.5">
                    why
                  </span>
                  <span>{why}</span>
                </p>
              );
            })()}

            {/* Next physical action — full text, not truncated */}
            {task.nextPhysicalAction && task.nextPhysicalAction !== task.title && (
              <p className="text-[10px] text-zinc-400 leading-snug">
                <span className="text-zinc-600 font-mono uppercase tracking-wider text-[8px] mr-1.5">
                  next
                </span>
                → {task.nextPhysicalAction}
              </p>
            )}

            {/* Finish condition */}
            {task.finishCondition && (
              <p className="text-[10px] text-zinc-400 leading-snug">
                <span className="text-zinc-600 font-mono uppercase tracking-wider text-[8px] mr-1.5">
                  done when
                </span>
                {task.finishCondition}
              </p>
            )}

            {/* Promise to (full, not truncated) */}
            {kind === "PROMISE" && task.promiseTo && (
              <p className="text-[10px] text-violet-300">
                <span className="text-violet-400/50 font-mono uppercase tracking-wider text-[8px] mr-1.5">
                  promised to
                </span>
                {task.promiseTo}
              </p>
            )}

            {/* Apr 26 · F6 — TaskEvent timeline. Lazy-fetched
                when the panel opens. Shows the full lifecycle:
                created → started → reframed → snoozed → … */}
            <div className="pt-1 border-t border-zinc-900">
              <EventTimeline taskId={task.id} />
            </div>

            {/* Metadata grid */}
            <div className="grid grid-cols-2 gap-1.5 text-[9px] pt-1 border-t border-zinc-900">
              {task.mission?.title && (
                <div>
                  <div className="text-zinc-700 uppercase tracking-wider text-[8px] font-mono">mission</div>
                  <div className="text-zinc-400 truncate">{task.mission.title}</div>
                </div>
              )}
              {/* Apr 27 · DOMAIN-EDIT — tap to open inline
                  picker; anchors (work/personal/health) +
                  custom domains from the filter row's
                  localStorage list show up here. Posts to the
                  new /domain endpoint which swaps missionId
                  to a per-domain Inbox. */}
              {task.mission?.domain && (
                <div className="col-span-1">
                  <div className="text-zinc-700 uppercase tracking-wider text-[8px] font-mono">domain</div>
                  {isDomainEditing ? (
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {(() => {
                        const ANCHORS = ["work", "personal", "health"];
                        const all = Array.from(
                          new Set([...ANCHORS, ...customDomainOptions]),
                        );
                        return all.map((d) => {
                          const isCurrent =
                            task.mission?.domain?.toLowerCase() === d ||
                            (d === "work" &&
                              task.mission?.domain === "BUSINESS");
                          return (
                            <button
                              key={d}
                              type="button"
                              disabled={domainSwapBusy}
                              onClick={() => {
                                if (isCurrent) {
                                  onCancelDomainEdit();
                                  return;
                                }
                                onCommitDomainSwap(task.id, d);
                              }}
                              className={cn(
                                "text-[8px] px-1.5 py-px rounded border uppercase tracking-wider transition-all",
                                isCurrent
                                  ? "border-violet-500/50 bg-violet-500/15 text-violet-300"
                                  : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:bg-zinc-800",
                                domainSwapBusy && "opacity-60",
                              )}
                            >
                              {isCurrent ? `✓ ${d}` : d}
                            </button>
                          );
                        });
                      })()}
                      <button
                        type="button"
                        onClick={onCancelDomainEdit}
                        className="text-[8px] text-zinc-600 hover:text-zinc-400 ml-1"
                      >
                        cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onOpenDomainEdit(task.id)}
                      className="text-zinc-400 hover:text-zinc-200 hover:underline decoration-dotted text-left"
                      title="Tap to change domain"
                    >
                      {task.mission.domain}
                    </button>
                  )}
                </div>
              )}
              {task.effort && (
                <div>
                  <div className="text-zinc-700 uppercase tracking-wider text-[8px] font-mono">effort</div>
                  <div className="text-zinc-400 font-mono">{EFF[task.effort] || task.effort}</div>
                </div>
              )}
              {task.context && (
                <div>
                  <div className="text-zinc-700 uppercase tracking-wider text-[8px] font-mono">context</div>
                  <div className="text-zinc-400">{task.context}</div>
                </div>
              )}
              {task.energyRequired && (
                <div>
                  <div className="text-zinc-700 uppercase tracking-wider text-[8px] font-mono">energy</div>
                  <div className="text-zinc-400">
                    {task.energyRequired?.toLowerCase()}
                  </div>
                </div>
              )}
              {task.autoPriority != null && (
                <div>
                  <div className="text-zinc-700 uppercase tracking-wider text-[8px] font-mono">priority</div>
                  <div className="text-zinc-400 font-mono">
                    {task.autoPriority}
                  </div>
                </div>
              )}
              {task.dueDate && (
                <div>
                  <div className="text-zinc-700 uppercase tracking-wider text-[8px] font-mono">due</div>
                  <div className={cn("font-mono", overdue ? "text-red-400" : "text-zinc-400")}>
                    {new Date(task.dueDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </div>
                </div>
              )}
              {task.createdAt && (
                <div>
                  <div className="text-zinc-700 uppercase tracking-wider text-[8px] font-mono">created</div>
                  <div className="text-zinc-400">{ag(task.createdAt)} ago</div>
                </div>
              )}
              {task.originSource && (
                <div>
                  <div className="text-zinc-700 uppercase tracking-wider text-[8px] font-mono">source</div>
                  <div className="text-zinc-400 font-mono truncate" title={task.originSource}>
                    {originSourceLabel(task.originSource) ?? task.originSource}
                  </div>
                </div>
              )}
            </div>

            {/* Action row — F4 snooze popover takes over when
                active; otherwise default verbs render. */}
            {isSnoozing ? (
              <div className="flex items-center gap-1.5 pt-1 border-t border-zinc-900">
                <span className="text-[9px] uppercase tracking-wider text-zinc-500 font-mono mr-1">
                  push to
                </span>
                {([
                  { d: 1, label: "tomorrow" },
                  { d: 3, label: "+3d" },
                  { d: 7, label: "next week" },
                ] as const).map((opt) => (
                  <button
                    key={opt.d}
                    type="button"
                    onClick={() => onCommitSnooze(task.id, opt.d)}
                    disabled={isReviewBusy}
                    className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-[10px] font-medium text-amber-300 hover:bg-amber-500/15 disabled:opacity-50"
                  >
                    {isReviewBusy ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <Clock size={11} />
                    )}
                    {opt.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={onCancelSnooze}
                  className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-zinc-500 hover:text-zinc-300"
                >
                  cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 pt-1 border-t border-zinc-900 flex-wrap">
                {onStart && task.status !== "DOING" && (
                  <button
                    type="button"
                    onClick={() => onStart(task.id)}
                    className="inline-flex items-center gap-1 rounded-md border border-blue-500/30 bg-blue-500/5 px-2 py-1 text-[10px] font-medium text-blue-300 hover:bg-blue-500/15"
                  >
                    <Zap size={11} />
                    start
                  </button>
                )}
                {/* F1 · edit — flips the panel into form mode. */}
                <button
                  type="button"
                  onClick={() => onOpenEditFromPanel(task)}
                  className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] font-medium text-zinc-300 hover:bg-zinc-800"
                >
                  <Edit3 size={11} />
                  edit
                </button>
                {/* F4 · snooze — flips the row into snooze mode. */}
                <button
                  type="button"
                  onClick={() => onOpenSnooze(task.id)}
                  className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 px-2 py-1 text-[10px] font-medium text-amber-300 hover:bg-amber-500/10"
                >
                  <Clock size={11} />
                  snooze
                </button>
                {/* Apr 27 · GOAL-EDIT — change or unlink the
                    goal this task is bound to. Parent owns the
                    picker UI (centered sheet on tap). When the
                    task already has a wrong goal (e.g. a
                    business task tied to weight goal), label
                    shifts to "change goal" so the affordance
                    is obvious. */}
                {onEditTaskGoal && (
                  <button
                    type="button"
                    onClick={() => onEditTaskGoal(task.id)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium",
                      task.goalId
                        ? "border-violet-500/30 text-violet-300 hover:bg-violet-500/10"
                        : "border-zinc-700 text-zinc-400 hover:bg-zinc-800",
                    )}
                    title={
                      task.goalId
                        ? "Change or unlink this task's goal"
                        : "Link this task to a goal"
                    }
                  >
                    <Target size={11} />
                    {task.goalId ? "change goal" : "link goal"}
                  </button>
                )}
                {/* May 02 · v10.0.146 · PROJECT-EDIT — single
                    button opens the LinkProjectPicker. Replaced
                    the old inline "leave project" button (which
                    could only clear missionId, never set it).
                    The picker now hosts both: pick any active
                    project to MOVE the task, or use the in-sheet
                    "leave project" affordance to clear the link.
                    Pre-fix Nour had no UI to relocate a task
                    from Inbox to a real project. */}
                {onEditTaskMission && (
                  <button
                    type="button"
                    onClick={() => onEditTaskMission(task.id)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium",
                      task.missionId
                        ? "border-blue-500/30 text-blue-300 hover:bg-blue-500/10"
                        : "border-zinc-700 text-zinc-400 hover:bg-zinc-800",
                    )}
                    title={
                      task.missionId
                        ? "Move this task to a different project (or remove from project)"
                        : "Link this task to a project"
                    }
                  >
                    <Briefcase size={11} />
                    {task.missionId ? "change project" : "link project"}
                  </button>
                )}
                {onPin && (
                  <button
                    type="button"
                    onClick={() => onPin(task.id)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-medium",
                      isPinned
                        ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                        : "border-zinc-700 text-zinc-400 hover:bg-zinc-800"
                    )}
                  >
                    <Pin size={11} />
                    {isPinned ? "pinned" : "pin"}
                  </button>
                )}
                {kind === "PROMISE" && onBreakPromise && (
                  <button
                    type="button"
                    onClick={() => onOpenBreakModal(task.id, task.title)}
                    className="inline-flex items-center gap-1 rounded-md border border-rose-500/30 px-2 py-1 text-[10px] font-medium text-rose-300 hover:bg-rose-500/10"
                  >
                    <X size={11} />
                    break promise
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onDelete(task.id)}
                  className="inline-flex items-center gap-1 rounded-md border border-zinc-700 px-2 py-1 text-[10px] font-medium text-zinc-500 hover:border-rose-500/30 hover:text-rose-300"
                >
                  <Trash2 size={11} />
                  delete
                </button>
                <button
                  type="button"
                  onClick={onCollapse}
                  className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-zinc-500 hover:text-zinc-300"
                >
                  collapse
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Hover actions */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {/* Apr 26 · F10 — drag affordance. Cursor signals
            drag is wired; the row container itself owns the
            HTML5 drag listeners so any grab on the row works. */}
        <span
          className="cursor-grab active:cursor-grabbing p-1 text-zinc-700 hover:text-zinc-400"
          title="Drag to reorder"
          aria-hidden
        >
          <GripVertical size={10} />
        </span>
        {onPin && (
          <button
            onClick={() => onPin(task.id)}
            className={cn(
              "p-1 rounded",
              isPinned ? "text-[var(--gold)]" : "text-zinc-700 hover:text-[var(--gold)]"
            )}
            aria-label="Pin"
          >
            <Pin size={10} />
          </button>
        )}
        {kind === "PROMISE" && (
          <button
            onClick={() => {
              // Open the reason modal. If onBreakPromise
              // isn't wired, fall through to onDelete as a
              // last-resort so the button isn't dead.
              if (onBreakPromise) {
                onOpenBreakModal(task.id, task.title);
              } else {
                void onDelete(task.id);
              }
            }}
            className="p-1 rounded text-zinc-700 hover:text-red-400"
            aria-label="Mark broken"
            title="Mark broken"
          >
            <X size={11} />
          </button>
        )}
        {kind !== "PROMISE" && (
          <button
            onClick={() => onDelete(task.id)}
            className="p-1 rounded text-zinc-700 hover:text-red-400"
            aria-label="Delete"
          >
            <Trash2 size={10} />
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Memoized export. Default shallow equality is the right boundary —
 * the parent passes per-row PRIMITIVES (booleans + strings) and
 * STABLE callback refs (useCallback'd in the parent). A row only
 * re-renders when one of ITS values flips, not when any sibling's
 * does. If a callback prop is observed to be unstable, that's a bug
 * at the call site (parent), not at this memo boundary.
 */
export const LoopRowItem = memo(LoopRowItemImpl);
