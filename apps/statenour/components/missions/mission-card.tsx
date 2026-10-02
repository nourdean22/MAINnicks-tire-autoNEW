"use client";

/**
 * MissionCard · 2026-05-28 · Wave AA Phase 1A.
 *
 * The per-mission collapsible card · the new top-level unit of /missions.
 *
 *   ▼ POWER ATLAS v2                  64% · 8d           [ ⋯ ]
 *     ─────────────────────────────────────────────────────
 *     ◐ Wire detail-panel ErrorBoundary       doing  2d late
 *     ○ Backfill 7 more PersonProfiles                3d
 *     ○ Tag Mash + Manny separately
 *     [+ task to this mission]
 *     ─────────────────────────────────────────────────────
 *     [complete mission]    [archive]
 *
 * Replaces the old "MissionScoreboard as widget below the fold" model.
 * Now every active mission IS a row on the page. Tap header → toggle
 * task list visibility. Tap task checkbox → complete. Tap add input
 * → create new task pre-attached to this mission.
 *
 * Phase 2 will add "Nick's pick" — a single highlighted top task per
 * mission. Phase 3 will add the complete-mission cascade (close all
 * remaining tasks + open retro modal).
 */

import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Flag,
  Pencil,
  Plus,
  GripVertical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Project, Task } from "@/components/actions/shared";
import { MissionTaskRow } from "./mission-task-row";
import { missionHasEndState } from "@/lib/services/mission-helpers";

export interface MissionCardProps {
  mission: Project;
  tasks: Task[];
  defaultExpanded?: boolean;
  /** Optional · Phase 2 · the single Nick-picked task for this mission.
   *  When provided, the row renders pinned at the top with a gold
   *  treatment + a "Nick's pick" eyebrow. */
  nicksPickTaskId?: string;
  /** Optional · Phase 2 · Nick's 1-line rationale for the pick. */
  nicksPickRationale?: string;
  /** Wave AJ · 2026-05-28 · ↑/↓ reorder. Parent passes index + total
   *  so the card can disable arrows at the ends. */
  missionIdx?: number;
  totalMissions?: number;
  isDragged?: boolean;

  isDraggedOver?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onTaskDropOnMission?: (taskId: string, missionId: string) => void;
}

import { useMissionDispatch } from "@/app/(mastery)/missions/context/mission-dispatch-context";

export function MissionCard({
  mission,
  tasks,
  defaultExpanded = true,
  nicksPickTaskId,
  nicksPickRationale,
  missionIdx,
  totalMissions,
  isDragged,
  isDraggedOver,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onTaskDropOnMission,
}: MissionCardProps) {
  const actions = useMissionDispatch();
  const canMoveUp = typeof missionIdx === "number" && missionIdx > 0;
  const canMoveDown = typeof missionIdx === "number" && typeof totalMissions === "number" && missionIdx < totalMissions - 1;
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [adding, setAdding] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Drag and drop states
  const [isMissionDraggable, setIsMissionDraggable] = useState(false);
  const [draggedTaskIdx, setDraggedTaskIdx] = useState<number | null>(null);
  const [draggedOverTaskIdx, setDraggedOverTaskIdx] = useState<number | null>(null);

  const { openTasks, doneTasks, progress, hasEndState, deadlineLabel, deadlineTone } =
    useMemo(() => derivedMetrics(mission, tasks), [mission, tasks]);

  // Sort: Nick's pick first, then DOING, then autoPriority (higher =
  // more urgent — canonical polarity), then by due date (urgent first),
  // then by createdAt. Done tasks sink to the bottom (visible but dimmed).
  const sortedOpen = useMemo(() => {
    return [...openTasks].sort((a, b) => {
      if (nicksPickTaskId === a.id) return -1;
      if (nicksPickTaskId === b.id) return 1;
      if (a.status === "DOING" && b.status !== "DOING") return -1;
      if (b.status === "DOING" && a.status !== "DOING") return 1;

      const aPri = a.autoPriority ?? -Infinity;
      const bPri = b.autoPriority ?? -Infinity;
      if (aPri !== bPri) {
        return bPri - aPri;
      }

      const aDue = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const bDue = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      if (aDue !== bDue) {
        return aDue - bDue;
      }

      const aCreated = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bCreated = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return aCreated - bCreated;
    });
  }, [openTasks, nicksPickTaskId]);

  const handleTaskDragStart = (e: React.DragEvent, taskIndex: number) => {
    setDraggedTaskIdx(taskIndex);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleTaskDragOver = (e: React.DragEvent, taskIndex: number) => {
    e.preventDefault();
    if (draggedTaskIdx === null || draggedTaskIdx === taskIndex) return;
    setDraggedOverTaskIdx(taskIndex);
  };

  const handleTaskDragLeave = () => {
    setDraggedOverTaskIdx(null);
  };

  const handleTaskDrop = async (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    const sourceIndex = draggedTaskIdx;
    setDraggedTaskIdx(null);
    setDraggedOverTaskIdx(null);

    if (sourceIndex === null || sourceIndex === targetIndex) return;

    const task = sortedOpen[sourceIndex];
    if (!task) return;

    try {
      // Execution Deck P0 (2026-09-01): per-step refetch skipped; settle once.
      if (targetIndex < sourceIndex) {
        for (let i = sourceIndex; i > targetIndex; i--) {
          await actions.handleMoveTask(task.id, "up", { skipRefetch: true });
        }
      } else {
        for (let i = sourceIndex; i < targetIndex; i++) {
          await actions.handleMoveTask(task.id, "down", { skipRefetch: true });
        }
      }
    } catch (err) {
      console.error("Failed to reorder task via drag & drop", err);
    } finally {
      await actions.settleReorder();
    }
  };

  const handleAdd = async () => {
    const trimmed = newTaskTitle.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await actions.handleAddTask({ title: trimmed, missionId: mission.id });
      setNewTaskTitle("");
      setAdding(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <article
      id={`mission-${mission.id}`}
      draggable={isMissionDraggable}
      onDragStart={onDragStart}
      onDragEnd={() => {
        setIsMissionDraggable(false);
        onDragEnd?.();
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("application/vnd.nour.task-id")) {
          e.preventDefault(); // Allow task drop
        }
        onDragOver?.(e);
      }}
      onDragLeave={onDragLeave}
      onDrop={(e) => {
        const droppedTaskId = e.dataTransfer.getData("application/vnd.nour.task-id");
        if (droppedTaskId && onTaskDropOnMission) {
          e.preventDefault();
          e.stopPropagation();
          onTaskDropOnMission(droppedTaskId, mission.id);
          return;
        }
        onDrop?.(e);
      }}
      // Wave AR · 2026-05-28 · row anchor · TopMissionToday CTA points
      // at #mission-<id> · MissionsHealthStrip chips link here too ·
      // smooth-scroll lands the operator on the right card.
      // 2026-09-16 · Visible Transformation: the board is a ruled list (the
      // parent divides missions with hairlines); an open mission is marked by
      // a gold left rule, never a glowing box.
      className={cn(
        "scroll-mt-24 border-l-2 transition-colors duration-[var(--motion-state)]",
        expanded ? "border-l-accent" : "border-l-transparent",
        isDraggedOver && "border-l-accent/60 bg-accent-soft"
      )}
    >
      {/* Header · tap to toggle.
          2026-09-16 · a div-as-button, not a <button>: the reorder arrows and
          the edit affordance inside it are interactive, and a <button> inside
          a <button> is invalid HTML that React reports as a hydration error
          on every card render (seen on the seeded hermetic render). Same
          pattern as the People rows. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
        aria-expanded={expanded}
        aria-label={`${expanded ? "collapse" : "expand"} mission ${mission.title}`}
        className="flex w-full cursor-pointer items-center gap-2 px-3 py-4 text-left transition-transform active:scale-[0.995] sm:px-4"
      >
        <div
          onMouseDown={(e) => {
            e.stopPropagation();
            setIsMissionDraggable(true);
          }}
          onMouseUp={(e) => {
            e.stopPropagation();
            setIsMissionDraggable(false);
          }}
          onClick={(e) => {
            e.stopPropagation();
          }}
          className="p-1 cursor-grab active:cursor-grabbing text-fg-tertiary hover:text-fg transition-colors duration-[var(--motion-state)] shrink-0"
          aria-label="Drag to reorder mission"
        >
          <GripVertical size={14} />
        </div>
        {expanded ? (
          <ChevronDown
            size={14}
            className="text-fg-secondary shrink-0"
            strokeWidth={2}
          />
        ) : (
          <ChevronRight
            size={14}
            className="text-fg-tertiary shrink-0"
            strokeWidth={2}
          />
        )}
        <Flag
          size={11}
          className="text-fg-tertiary shrink-0"
          strokeWidth={2}
        />
        <h3 className="flex-1 truncate text-[17px] font-semibold leading-tight tracking-[-0.01em] text-fg sm:text-[18px]">
          {mission.title}
        </h3>
        {/* wave-AA-audit · hide "0%" when the mission has no tasks ·
         *  empty missions show a "+ add task" CTA instead, the 0% chip
         *  was a misleading anchor on fresh missions.
         *
         *  2026-08-23 · same judgment, generalised. A percentage answers
         *  "how close to finished", which only means something for a mission
         *  that CAN finish. On a life-area bucket the figure fell whenever the
         *  operator captured a task and sat near 79% forever. Buckets now show
         *  the open count — the number they can act on. Percentage returns
         *  automatically once a deadline or completionCriteria is set. */}
        {openTasks.length + doneTasks.length > 0 &&
          (hasEndState ? (
            <span className="shrink-0 font-mono text-[12px] uppercase tracking-[0.12em] tabular-nums text-fg-tertiary">
              {progress}%
            </span>
          ) : (
            <span
              className="shrink-0 font-mono text-[12px] uppercase tracking-[0.12em] tabular-nums text-fg-tertiary"
              title={`${doneTasks.length} done · no completion target set for this mission`}
            >
              {openTasks.length} open
            </span>
          ))}
        {deadlineLabel && (
          <span
            className={cn(
              "shrink-0 font-mono text-[12px] uppercase tracking-[0.12em] tabular-nums",
              deadlineTone === "urgent" && "text-rose-400",
              deadlineTone === "soon" && "text-amber-400",
              deadlineTone === "normal" && "text-fg-tertiary",
            )}
          >
            {deadlineLabel}
          </span>
        )}
        {/* Wave AJ · 2026-05-28 · mission reorder · operator complaint
         *  "how come i cant resort or change the orders of the missions
         *  or the tasks?" — ↑/↓ buttons swap rank with neighbor. Mobile-
         *  first · no drag-drop complexity (drag is finicky on iOS) ·
         *  stopPropagation so the outer expand toggle doesn't fire.
         *  Disabled at the ends (no wraparound · arrows fade visually).
         *  Wave AT · 2026-05-28 · always-on background tint + grouping
         *  border · pre-this-fix the buttons were color-tertiary at rest
         *  with hover-only background · invisible on mobile · operators
         *  didn't know reorder existed. Now they read as tappable at
         *  idle. Tightened to w-8 to free horizontal budget on mobile. */}
        {(canMoveUp || canMoveDown) && (
          <span className="shrink-0 inline-flex rounded-control border border-edge-default bg-content overflow-hidden">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (canMoveUp) actions.handleMoveMission(mission.id, "up");
              }}
              disabled={!canMoveUp}
              aria-label={`move mission ${mission.title} up`}
              title="move up"
              className={cn(
                "inline-flex h-11 w-11 items-center justify-center transition-transform active:scale-95",
                canMoveUp
                  ? "text-fg-secondary hover:text-fg hover:bg-surface-hover cursor-pointer"
                  : "text-fg-tertiary/30 cursor-not-allowed",
              )}
            >
              <ArrowUp size={14} strokeWidth={2} />
            </button>
            <span
              aria-hidden
              className="w-px bg-edge-default"
            />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (canMoveDown) actions.handleMoveMission(mission.id, "down");
              }}
              disabled={!canMoveDown}
              aria-label={`move mission ${mission.title} down`}
              title="move down"
              className={cn(
                "inline-flex h-11 w-11 items-center justify-center transition-transform active:scale-95",
                canMoveDown
                  ? "text-fg-secondary hover:text-fg hover:bg-surface-hover cursor-pointer"
                  : "text-fg-tertiary/30 cursor-not-allowed",
              )}
            >
              <ArrowDown size={14} strokeWidth={2} />
            </button>
          </span>
        )}
        {/* wave-AB.c · per-card edit pencil · stopPropagation so the
         *   outer expand toggle doesn't fire on tap.
         *   wave-AB.d-mobile · bumped from h-6 (24px) to h-11 (44px) ·
         *   Apple HIG tap-target floor · `active:scale-95` adds tap
         *   feedback since the iOS pressed-state isn't free here. */}
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            actions.handleEditMission(mission.id);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              actions.handleEditMission(mission.id);
            }
          }}
          aria-label={`edit mission ${mission.title}`}
          className="shrink-0 inline-flex h-11 w-11 items-center justify-center rounded-control text-fg-tertiary hover:text-fg hover:bg-surface-hover active:scale-95 transition-transform cursor-pointer"
        >
          <Pencil size={14} strokeWidth={1.75} />
        </span>
      </div>

      {/* Progress bar · hidden when mission has 0 tasks total · the
       *  0% sliver was misleading for fresh missions. wave-AA-audit
       *
       *  2026-08-23 · also hidden when the mission declares no end state. A
       *  bar that fills toward a target nobody set is a picture of a claim
       *  the data does not make. */}
      {openTasks.length + doneTasks.length > 0 && hasEndState && (
        <div className="px-3 pb-3 sm:px-4">
          <div className="h-px overflow-hidden bg-edge">
            <div
              className="h-full bg-fg-secondary transition-all duration-500"
              style={{ width: `${progress}%` }}
              aria-hidden
            />
          </div>
        </div>
      )}

      {/* Body · task list + add row + footer */}
      {expanded && (
        <div className="border-t border-edge pb-2">
          {/* Nick's pick rationale (Phase 2 · only shown when set) */}
          {nicksPickTaskId && nicksPickRationale && (
            <div className="border-b border-edge px-3 py-2 sm:px-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
                nick&apos;s pick
              </p>
              <p className="mt-0.5 text-[14px] leading-snug text-fg-secondary">
                {nicksPickRationale}
              </p>
            </div>
          )}

          {/* Task list */}
          <div className="divide-y divide-edge/60">
            {sortedOpen.length === 0 && doneTasks.length === 0 && (
              <p className="px-3 py-3 text-[14px] text-fg-tertiary sm:px-4">
                No tasks yet. Add one below.
              </p>
            )}
            {sortedOpen.map((task, taskIdx) => {
              const isNicksPick = nicksPickTaskId === task.id;
              return (
                <div
                  key={task.id}
                  className={cn(
                    isNicksPick && "border-l-2 border-l-edge-strong",
                  )}
                >
                  <MissionTaskRow
                    task={task}
                    isNicksPick={isNicksPick}
                    rationale={isNicksPick ? nicksPickRationale : undefined}
                    index={taskIdx}
                    totalTasks={sortedOpen.length}
                    onDragStart={(e) => handleTaskDragStart(e, taskIdx)}
                    onDragOver={(e) => handleTaskDragOver(e, taskIdx)}
                    onDragLeave={handleTaskDragLeave}
                    onDrop={(e) => handleTaskDrop(e, taskIdx)}
                    isDragged={draggedTaskIdx === taskIdx}
                    isDraggedOver={draggedOverTaskIdx === taskIdx}
                  />
                </div>
              );
            })}
            {doneTasks.length > 0 && (
              <details className="px-2">
                <summary className="flex min-h-[44px] cursor-pointer list-none items-center px-1 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary hover:text-fg-secondary">
                  ▸ {doneTasks.length} done
                </summary>
                <div>
                  {doneTasks.map((task) => (
                    <MissionTaskRow key={task.id} task={task} />
                  ))}
                </div>
              </details>
            )}
          </div>

          {/* Add row */}
          <div className="border-t border-edge/60 px-2 py-1.5 sm:px-3">
            {adding ? (
              <div className="flex items-center gap-3">
                <input
                  autoFocus
                  type="text"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleAdd();
                    if (e.key === "Escape") {
                      setAdding(false);
                      setNewTaskTitle("");
                    }
                  }}
                  placeholder="task title…"
                  disabled={submitting}
                  // wave-AB.d-mobile · inline add input · bump to 44px
                  // tap target + 16px font (iOS no-zoom).
                  className="min-h-[44px] flex-1 border-0 border-b border-edge bg-transparent px-1 py-2 text-[16px] text-fg placeholder:text-fg-tertiary transition-colors duration-[var(--motion-state)] focus:border-accent focus:outline-none disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={!newTaskTitle.trim() || submitting}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-edge-default bg-content text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg disabled:opacity-40"
                  aria-label="add task"
                >
                  <Plus size={14} strokeWidth={2} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="inline-flex min-h-[44px] w-full items-center gap-2 px-1 text-left text-[13px] font-medium text-fg-tertiary transition-colors duration-[var(--motion-state)] hover:text-fg"
              >
                <Plus size={14} strokeWidth={1.75} />
                add task to this mission
              </button>
            )}
          </div>

          {/* Footer · mission actions */}
          {openTasks.length === 0 && doneTasks.length > 0 && (
            <div className="flex items-center justify-between gap-2 border-t border-edge/60 px-3 sm:px-4">
              <button
                type="button"
                onClick={() => actions.handleCompleteMission(mission.id)}
                className="inline-flex min-h-[44px] items-center text-[13px] font-medium text-fg hover:underline"
              >
                complete mission ↗
              </button>
              <button
                type="button"
                onClick={() => actions.handleArchiveMission(mission.id)}
                className="inline-flex min-h-[44px] items-center text-[13px] font-medium text-fg-tertiary transition-colors duration-[var(--motion-state)] hover:text-fg"
              >
                archive
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

/**
 * Exported for tests/components/mission-progress-gate.test.ts. Rendering
 * MissionCard needs the mission-dispatch context plus tRPC-backed task rows;
 * this is the pure function that decides what the header actually shows, so
 * the canary asserts it directly and a second check asserts the render sites
 * consume it. Not intended for import by other components.
 */
export function derivedMetrics(
  mission: Project,
  tasks: Task[],
): {
  openTasks: Task[];
  doneTasks: Task[];
  progress: number;
  /** True only when the mission declares a finish — a deadline or explicit
   *  completionCriteria. A life-area bucket has no 100%, so it gets an open
   *  count instead of a percentage. See missionHasEndState for the measured
   *  reasoning and why successMetric deliberately does NOT count. */
  hasEndState: boolean;
  deadlineLabel: string | null;
  deadlineTone: "urgent" | "soon" | "normal" | null;
} {
  const openTasks = tasks.filter((t) => t.status !== "DONE");
  const doneTasks = tasks.filter((t) => t.status === "DONE");
  const total = openTasks.length + doneTasks.length;
  const progress = total === 0 ? 0 : Math.round((doneTasks.length / total) * 100);
  const hasEndState = missionHasEndState(mission);

  let deadlineLabel: string | null = null;
  let deadlineTone: "urgent" | "soon" | "normal" | null = null;
  if (mission.deadline) {
    const due = new Date(mission.deadline);
    if (!Number.isNaN(due.getTime())) {
      const days = Math.round(
        (due.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
      );
      if (days < 0) {
        deadlineLabel = `${Math.abs(days)}d late`;
        deadlineTone = "urgent";
      } else if (days <= 3) {
        deadlineLabel = `${days}d`;
        deadlineTone = "urgent";
      } else if (days <= 7) {
        deadlineLabel = `${days}d`;
        deadlineTone = "soon";
      } else {
        deadlineLabel = `${days}d`;
        deadlineTone = "normal";
      }
    }
  }

  return { openTasks, doneTasks, progress, hasEndState, deadlineLabel, deadlineTone };
}
