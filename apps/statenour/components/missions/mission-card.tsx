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
import { ChevronDown, ChevronRight, Flag, Pencil, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Project, Task } from "@/components/actions/shared";
import { MissionTaskRow } from "./mission-task-row";

export interface MissionCardProps {
  mission: Project;
  tasks: Task[];
  defaultExpanded?: boolean;
  onAddTask: (
    payload: { title: string; missionId: string },
  ) => void | Promise<void>;
  onCompleteTask: (id: string) => void | Promise<void>;
  onStartTask?: (id: string) => void | Promise<void>;
  onDeleteTask?: (id: string) => void | Promise<void>;
  onCompleteMission?: (missionId: string) => void | Promise<void>;
  onArchiveMission?: (missionId: string) => void | Promise<void>;
  /** Wave AB.c · operator taps the pencil on the header → page opens
   *  MissionEditDrawer with this mission. */
  onEditMission?: (missionId: string) => void;
  /** Wave AB.c · operator taps the pencil on a task row → page opens
   *  TaskEditSheet with the full task. */
  onEditTask?: (task: Task) => void;
  /** Optional · Phase 2 · the single Nick-picked task for this mission.
   *  When provided, the row renders pinned at the top with a gold
   *  treatment + a "Nick's pick" eyebrow. */
  nicksPickTaskId?: string;
  /** Optional · Phase 2 · Nick's 1-line rationale for the pick. */
  nicksPickRationale?: string;
}

export function MissionCard({
  mission,
  tasks,
  defaultExpanded = true,
  onAddTask,
  onCompleteTask,
  onStartTask,
  onDeleteTask,
  onCompleteMission,
  onArchiveMission,
  onEditMission,
  onEditTask,
  nicksPickTaskId,
  nicksPickRationale,
}: MissionCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [adding, setAdding] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { openTasks, doneTasks, progress, deadlineLabel, deadlineTone } =
    useMemo(() => derivedMetrics(mission, tasks), [mission, tasks]);

  // Sort: Nick's pick first, then DOING, then by due date (urgent first),
  // then by createdAt. Done tasks sink to the bottom (visible but dimmed).
  const sortedOpen = useMemo(() => {
    return [...openTasks].sort((a, b) => {
      if (nicksPickTaskId === a.id) return -1;
      if (nicksPickTaskId === b.id) return 1;
      if (a.status === "DOING" && b.status !== "DOING") return -1;
      if (b.status === "DOING" && a.status !== "DOING") return 1;
      const aDue = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
      const bDue = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
      return aDue - bDue;
    });
  }, [openTasks, nicksPickTaskId]);

  const handleAdd = async () => {
    const trimmed = newTaskTitle.trim();
    if (!trimmed) return;
    setSubmitting(true);
    try {
      await onAddTask({ title: trimmed, missionId: mission.id });
      setNewTaskTitle("");
      setAdding(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <article
      className={cn(
        "rounded-lg border bg-[var(--bg-base)]",
        expanded
          ? "border-[var(--gold)]/30 shadow-[0_0_20px_rgba(253,185,19,0.05)]"
          : "border-[var(--border-default)]",
      )}
    >
      {/* Header · tap to toggle */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={`${expanded ? "collapse" : "expand"} mission ${mission.title}`}
        className="w-full flex items-center gap-2 px-3 py-3 text-left active:scale-[0.995] transition-transform"
      >
        {expanded ? (
          <ChevronDown
            size={14}
            className="text-[var(--gold)] shrink-0"
            strokeWidth={2}
          />
        ) : (
          <ChevronRight
            size={14}
            className="text-[var(--text-tertiary)] shrink-0"
            strokeWidth={2}
          />
        )}
        <Flag
          size={11}
          className="text-[var(--gold)] shrink-0"
          strokeWidth={2}
        />
        <h3 className="flex-1 text-[13px] font-bold uppercase tracking-[0.1em] text-[var(--text-primary)] truncate">
          {mission.title}
        </h3>
        {/* wave-AA-audit · hide "0%" when the mission has no tasks ·
         *  empty missions show a "+ add task" CTA instead, the 0% chip
         *  was a misleading anchor on fresh missions. */}
        {openTasks.length + doneTasks.length > 0 && (
          <span className="text-[10px] font-mono tabular-nums text-[var(--text-tertiary)] shrink-0">
            {progress}%
          </span>
        )}
        {deadlineLabel && (
          <span
            className={cn(
              "text-[10px] font-mono tabular-nums shrink-0",
              deadlineTone === "urgent" && "text-rose-400",
              deadlineTone === "soon" && "text-amber-400",
              deadlineTone === "normal" && "text-[var(--text-tertiary)]",
            )}
          >
            {deadlineLabel}
          </span>
        )}
        {/* wave-AB.c · per-card edit pencil · stopPropagation so the
         *   outer expand toggle doesn't fire on tap.
         *   wave-AB.d-mobile · bumped from h-6 (24px) to h-11 (44px) ·
         *   Apple HIG tap-target floor · `active:scale-95` adds tap
         *   feedback since the iOS pressed-state isn't free here. */}
        {onEditMission && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onEditMission(mission.id);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                onEditMission(mission.id);
              }
            }}
            aria-label={`edit mission ${mission.title}`}
            className="shrink-0 inline-flex h-11 w-11 items-center justify-center rounded text-[var(--text-tertiary)] hover:text-[var(--gold)] hover:bg-[var(--gold)]/[0.05] active:scale-95 transition-transform cursor-pointer"
          >
            <Pencil size={14} strokeWidth={1.75} />
          </span>
        )}
      </button>

      {/* Progress bar · hidden when mission has 0 tasks total · the
       *  0% sliver was misleading for fresh missions. wave-AA-audit */}
      {openTasks.length + doneTasks.length > 0 && (
        <div className="px-3 -mt-2 pb-2">
          <div className="h-0.5 bg-[var(--border-default)]/40 rounded-full overflow-hidden">
            <div
              className="h-full bg-[var(--gold)] transition-all duration-500"
              style={{ width: `${progress}%` }}
              aria-hidden
            />
          </div>
        </div>
      )}

      {/* Body · task list + add row + footer */}
      {expanded && (
        <div className="border-t border-[var(--border-default)]/60">
          {/* Nick's pick rationale banner (Phase 2 · only shown when set) */}
          {nicksPickTaskId && nicksPickRationale && (
            <div className="border-b border-[var(--border-default)]/60 px-3 py-1.5 bg-[var(--gold)]/[0.04]">
              <p className="text-[9px] font-mono uppercase tracking-[0.18em] text-[var(--gold)]/80">
                nick&apos;s pick
              </p>
              <p className="text-[11px] text-[var(--text-secondary)] leading-snug mt-0.5">
                {nicksPickRationale}
              </p>
            </div>
          )}

          {/* Task list */}
          <div className="py-1">
            {sortedOpen.length === 0 && doneTasks.length === 0 && (
              <p className="px-3 py-3 text-[12px] text-[var(--text-tertiary)] italic">
                No tasks yet. Add one below.
              </p>
            )}
            {sortedOpen.map((task) => (
              <div
                key={task.id}
                className={cn(
                  nicksPickTaskId === task.id &&
                    "border-l-2 border-l-[var(--gold)]/70",
                )}
              >
                <MissionTaskRow
                  task={task}
                  onComplete={onCompleteTask}
                  onStart={onStartTask}
                  onDelete={onDeleteTask}
                  onEdit={onEditTask}
                />
              </div>
            ))}
            {doneTasks.length > 0 && (
              <details className="px-2">
                <summary className="px-1 py-1.5 text-[10px] font-mono uppercase tracking-[0.15em] text-[var(--text-tertiary)] cursor-pointer hover:text-[var(--text-secondary)] list-none">
                  ▸ {doneTasks.length} done
                </summary>
                <div>
                  {doneTasks.map((task) => (
                    <MissionTaskRow
                      key={task.id}
                      task={task}
                      onComplete={onCompleteTask}
                      onEdit={onEditTask}
                    />
                  ))}
                </div>
              </details>
            )}
          </div>

          {/* Add row */}
          <div className="border-t border-[var(--border-default)]/40 px-2 py-1.5">
            {adding ? (
              <div className="flex gap-1.5 items-center">
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
                  className="flex-1 min-h-[44px] rounded-md border border-[var(--gold)]/30 bg-[var(--bg-raised)]/[0.06] px-2.5 py-2 text-[16px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]/70 focus:border-[var(--gold)]/60 focus:outline-none transition-colors disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={handleAdd}
                  disabled={!newTaskTitle.trim() || submitting}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--gold)]/40 bg-[var(--gold)]/10 text-[var(--gold)] hover:bg-[var(--gold)]/15 disabled:opacity-40"
                  aria-label="add task"
                >
                  <Plus size={14} strokeWidth={2} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="w-full text-left inline-flex items-center gap-2 px-2 py-1.5 rounded-md text-[12px] text-[var(--text-tertiary)] hover:text-[var(--gold)] hover:bg-[var(--gold)]/[0.05] transition-colors"
              >
                <Plus size={12} strokeWidth={1.75} />
                add task to this mission
              </button>
            )}
          </div>

          {/* Footer · mission actions */}
          {(onCompleteMission || onArchiveMission) && openTasks.length === 0 && doneTasks.length > 0 && (
            <div className="border-t border-[var(--border-default)]/40 px-3 py-2 flex items-center justify-between gap-2">
              {onCompleteMission && (
                <button
                  type="button"
                  onClick={() => onCompleteMission(mission.id)}
                  className="text-[11px] font-mono uppercase tracking-[0.15em] text-[var(--gold)] hover:underline"
                >
                  complete mission ↗
                </button>
              )}
              {onArchiveMission && (
                <button
                  type="button"
                  onClick={() => onArchiveMission(mission.id)}
                  className="text-[11px] font-mono uppercase tracking-[0.15em] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                >
                  archive
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function derivedMetrics(
  mission: Project,
  tasks: Task[],
): {
  openTasks: Task[];
  doneTasks: Task[];
  progress: number;
  deadlineLabel: string | null;
  deadlineTone: "urgent" | "soon" | "normal" | null;
} {
  const openTasks = tasks.filter((t) => t.status !== "DONE");
  const doneTasks = tasks.filter((t) => t.status === "DONE");
  const total = openTasks.length + doneTasks.length;
  const progress = total === 0 ? 0 : Math.round((doneTasks.length / total) * 100);

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

  return { openTasks, doneTasks, progress, deadlineLabel, deadlineTone };
}
