"use client";

/**
 * MissionTaskRow · 2026-05-28 · Wave AA Phase 1A.
 *
 * Lighter alternative to LoopRowItem (~1400 LOC) for rendering a task
 * inside a MissionCard. The mission context already provides the goal
 * + project framing so the row itself can drop almost all metadata
 * decoration and lean into scannability:
 *
 *   ○ Wire detail-panel ErrorBoundary       ⏵ start   2d
 *
 * Checkbox circle · title · optional energy/effort glyph · due hint.
 * Tap title → edit. Tap checkbox → complete. Long-press (mobile) /
 * right-click (desktop) → context menu (start · delete · reassign).
 *
 * The richer LoopRowItem still lives at /tasks until the 308 redirect
 * is wired. Once /tasks → /missions, LoopRowItem becomes orphaned and
 * Phase 4's telemetry-driven prune can delete it.
 */

import { useState } from "react";
import { Check, Pencil, Play, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Task } from "@/components/actions/shared";

export interface MissionTaskRowProps {
  task: Task;
  onComplete: (id: string) => void | Promise<void>;
  onStart?: (id: string) => void | Promise<void>;
  onDelete?: (id: string) => void | Promise<void>;
  /** Wave AB.c · operator taps the pencil → page opens TaskEditSheet
   *  with this task · move-to-mission + status + due + energy + etc. */
  onEdit?: (task: Task) => void;
  /** Indent level · 0 = top, 1 = subtask. */
  indent?: 0 | 1;
}

export function MissionTaskRow({
  task,
  onComplete,
  onStart,
  onDelete,
  onEdit,
  indent = 0,
}: MissionTaskRowProps) {
  const [busy, setBusy] = useState<"complete" | "start" | "delete" | null>(
    null,
  );

  const isDoing = task.status === "DOING";
  const isDone = task.status === "DONE";

  const dueHint = formatDueHint(task.dueDate);

  return (
    <div
      className={cn(
        "group flex items-start gap-2 py-2 px-2.5 rounded-md transition-colors",
        "hover:bg-[var(--bg-raised)]/[0.06]",
        isDone && "opacity-50",
        indent === 1 && "ml-6 border-l border-[var(--border-default)]/40 pl-3",
      )}
    >
      {/* Checkbox circle · tap to complete */}
      <button
        type="button"
        onClick={async () => {
          setBusy("complete");
          try {
            await onComplete(task.id);
          } finally {
            setBusy(null);
          }
        }}
        disabled={busy === "complete" || isDone}
        aria-label={isDone ? "completed" : "mark complete"}
        className={cn(
          "shrink-0 mt-0.5 h-4 w-4 rounded-full border flex items-center justify-center transition-colors",
          isDone
            ? "bg-[var(--gold)]/30 border-[var(--gold)]/60 text-[var(--bg-void)]"
            : isDoing
              ? "border-amber-400/70 hover:border-amber-300"
              : "border-[var(--border-default)] hover:border-[var(--gold)]/60",
          busy === "complete" && "animate-pulse",
        )}
      >
        {isDone && <Check size={10} strokeWidth={3} />}
      </button>

      {/* Title + meta */}
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            "text-[13px] leading-snug text-[var(--text-primary)] break-words",
            isDone && "line-through",
          )}
        >
          {task.title}
        </p>
        {(dueHint ||
          task.energyRequired ||
          task.effort ||
          isDoing ||
          task.waitingOn) && (
          <div className="mt-0.5 flex items-center gap-2 text-[9px] font-mono uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
            {isDoing && <span className="text-amber-400">doing</span>}
            {task.waitingOn && (
              <span className="text-violet-300/80">⏸ {task.waitingOn}</span>
            )}
            {task.energyRequired && <span>{task.energyRequired} energy</span>}
            {task.effort && <span>{task.effort}</span>}
            {dueHint && <span>{dueHint}</span>}
          </div>
        )}
      </div>

      {/* Hover actions · wave-AB.d-mobile · always visible at touch
       *  breakpoint (no hover · invisible buttons = invisible features
       *  on phones). Apple HIG tap-target floor 44pt = h-11 w-11. The
       *  Pre-fix `opacity-0 group-hover` made mobile operators unable
       *  to edit/start/delete any task. */}
      {!isDone && (
        <div className="flex items-center gap-0.5 lg:opacity-0 lg:group-hover:opacity-100 lg:focus-within:opacity-100 transition-opacity">
          {onEdit && (
            <button
              type="button"
              onClick={() => onEdit(task)}
              aria-label="edit task"
              className="inline-flex h-11 w-11 items-center justify-center rounded text-[var(--text-tertiary)] hover:text-[var(--gold)] hover:bg-[var(--gold)]/10 active:scale-95 transition-transform"
            >
              <Pencil size={12} strokeWidth={2} />
            </button>
          )}
          {onStart && !isDoing && (
            <button
              type="button"
              onClick={async () => {
                setBusy("start");
                try {
                  await onStart(task.id);
                } finally {
                  setBusy(null);
                }
              }}
              disabled={busy === "start"}
              aria-label="start"
              className="inline-flex h-11 w-11 items-center justify-center rounded text-[var(--text-tertiary)] hover:text-amber-400 hover:bg-amber-500/10 active:scale-95 transition-transform disabled:opacity-50"
            >
              <Play size={12} strokeWidth={2} />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={async () => {
                setBusy("delete");
                try {
                  await onDelete(task.id);
                } finally {
                  setBusy(null);
                }
              }}
              disabled={busy === "delete"}
              aria-label="delete"
              className="inline-flex h-11 w-11 items-center justify-center rounded text-[var(--text-tertiary)] hover:text-rose-400 hover:bg-rose-500/10 active:scale-95 transition-transform disabled:opacity-50"
            >
              <Trash2 size={12} strokeWidth={2} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function formatDueHint(due: string | null | undefined): string | null {
  if (!due) return null;
  const d = new Date(due);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const msPerDay = 1000 * 60 * 60 * 24;
  const days = Math.round((d.getTime() - now.getTime()) / msPerDay);
  if (days < 0) return `${Math.abs(days)}d late`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
