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

import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Clock,
  Pencil,
  Play,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Task } from "@/components/actions/shared";
import { TaskPendingClassificationChip } from "@/components/missions/task-pending-classification-chip";

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
  /** Wave AJ · 2026-05-28 · ↑/↓ reorder · parent passes index + total
   *  so the row can disable the arrows at the ends. onMove fires with
   *  direction · parent computes swap + calls reorderTask mutation. */
  index?: number;
  totalTasks?: number;
  onMove?: (taskId: string, direction: "up" | "down") => void;
  /** Wave AV · 2026-05-28 · snooze for recurring (DAILY) tasks.
   *  Parent calls task.update with { snoozedUntil, status: "WAITING" }
   *  and the existing task-resurface cron flips WAITING→READY when
   *  the timestamp matures. snoozedUntilIso is a wall-clock ISO. */
  onSnooze?: (taskId: string, snoozedUntilIso: string) => void | Promise<void>;
}

/** Tomorrow at 6am local · the resurface cron flips WAITING→READY when
 *  snoozedUntil ≤ now · 6am gives the operator a soft morning re-entry
 *  rather than 12:01am churn. Pure helper · client-safe. */
function tomorrow6am(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(6, 0, 0, 0);
  return d.toISOString();
}

/** Next Monday at 6am local · "next week" presets to the start of the
 *  next operator-cadence week (Mon · matches the brain-week mental model). */
function nextMonday6am(): string {
  const d = new Date();
  const dow = d.getDay(); // 0 Sun · 1 Mon · ...
  const daysUntilNextMon = dow === 1 ? 7 : (8 - dow) % 7 || 7;
  d.setDate(d.getDate() + daysUntilNextMon);
  d.setHours(6, 0, 0, 0);
  return d.toISOString();
}

export function MissionTaskRow({
  task,
  onComplete,
  onStart,
  onDelete,
  onEdit,
  indent = 0,
  index,
  totalTasks,
  onMove,
  onSnooze,
}: MissionTaskRowProps) {
  const [busy, setBusy] = useState<
    "complete" | "start" | "delete" | "snooze" | null
  >(null);
  // Wave AV · 2026-05-28 · snooze popover · open state local to the row.
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  // Wave AW · 2026-05-28 · dismiss path · ref on the popover wrapper so
  // pointerdown handler can decide "inside or outside" cleanly. Without
  // this the operator could strand the popover open by tapping any
  // sibling row · the only escape was finding the original tiny pill
  // and tapping it again.
  const snoozeWrapRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => {
    if (!snoozeOpen) return;
    function onOutsidePointer(e: PointerEvent) {
      const node = snoozeWrapRef.current;
      if (!node) return;
      if (e.target instanceof Node && !node.contains(e.target)) {
        setSnoozeOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSnoozeOpen(false);
    }
    document.addEventListener("pointerdown", onOutsidePointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onOutsidePointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [snoozeOpen]);
  const isDaily =
    (task as unknown as { loopKind?: string }).loopKind === "DAILY";
  const snoozedUntil = (task as unknown as { snoozedUntil?: string | null })
    .snoozedUntil;
  const isSnoozed =
    isDaily &&
    typeof snoozedUntil === "string" &&
    Date.parse(snoozedUntil) > Date.now();
  const canMoveUp =
    onMove != null && typeof index === "number" && index > 0;
  const canMoveDown =
    onMove != null &&
    typeof index === "number" &&
    typeof totalTasks === "number" &&
    index < totalTasks - 1;

  const isDoing = task.status === "DOING";
  const isDone = task.status === "DONE";

  const dueHint = formatDueHint(task.dueDate);

  return (
    <div
      id={`task-${task.id}`}
      // Wave BF · 2026-05-29 · row anchor · /home "START →" + operator-pulse
      // emit /missions#task-<id> deep-links · Wave AR shipped mission-card
      // + goal anchors but never the task row · clicking a home CTA landed
      // at the top of /missions and made the operator scan. scroll-mt-24
      // honors the sticky ticker. Closes the orphan-anchor synergy gap.
      className={cn(
        "group flex items-start gap-2 py-2 px-2.5 rounded-md transition-all scroll-mt-24 border",
        isDoing
          ? "border-amber-500/30 bg-amber-500/[0.03] shadow-[0_0_12px_rgba(253,185,19,0.04)] animate-breath"
          : "border-transparent hover:bg-[var(--bg-raised)]/[0.06]",
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
        // 2026-05-28 · Wave AC.c · operator: "where do you complete a
        // task on mobile?" The h-4 w-4 circle (16px) was a sub-pt tap
        // target · invisible to fat fingers. New rule · 44pt tap zone
        // via outer button padding · the visible circle stays small
        // but the ENTIRE 44pt area is the click region.
        className={cn(
          "shrink-0 inline-flex items-center justify-center min-h-[44px] min-w-[44px] -m-2 p-2 rounded-full transition-colors active:scale-95",
          "[&>span]:h-5 [&>span]:w-5 [&>span]:rounded-full [&>span]:border",
          isDone
            ? "[&>span]:bg-[var(--gold)]/30 [&>span]:border-[var(--gold)]/60 text-[var(--bg-void)]"
            : isDoing
              ? "[&>span]:border-amber-400/70 hover:[&>span]:border-amber-300"
              : "[&>span]:border-[var(--border-default)] hover:[&>span]:border-[var(--gold)]/60",
          busy === "complete" && "[&>span]:animate-pulse",
        )}
      >
        <span className="flex items-center justify-center">
          {isDone && <Check size={12} strokeWidth={3} />}
        </span>
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
          task.waitingOn ||
          (task as unknown as { loopKind?: string }).loopKind === "DAILY") && (
          <div className="mt-0.5 flex items-center gap-2 text-[9px] font-mono uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
            {isDoing && <span className="text-amber-400">doing</span>}
            {task.waitingOn && (
              <span className="text-violet-300/80">⏸ {task.waitingOn}</span>
            )}
            {isDaily && (
              <span className="text-[var(--gold)]">
                ↻ daily
                {typeof (task as unknown as { streakCount?: number })
                  .streakCount === "number" &&
                (task as unknown as { streakCount?: number }).streakCount! >
                  0 && (
                  <>
                    {" "}
                    ·{" "}
                    {
                      (task as unknown as { streakCount?: number })
                        .streakCount
                    }
                    🔥
                  </>
                )}
              </span>
            )}
            {/* Wave AV · 2026-05-28 · snooze pill for DAILY tasks.
             *  Operator complaint precedent (Wave AL): "how come i can't
             *  create recurring tasks?" · the schema + cron resurfaced,
             *  but the daily row had no way to defer without breaking
             *  the streak. Pill opens a tiny popover · 2 presets ·
             *  Tomorrow 6am · Next Mon 6am · resurface cron flips
             *  WAITING→READY when the mark matures. */}
            {isDaily && onSnooze && (
              <span
                ref={snoozeWrapRef}
                className="relative inline-flex"
              >
                <button
                  type="button"
                  onClick={() => setSnoozeOpen((v) => !v)}
                  aria-label={isSnoozed ? "change snooze" : "snooze task"}
                  aria-expanded={snoozeOpen}
                  disabled={busy === "snooze"}
                  className={cn(
                    "inline-flex items-center gap-1 px-2 py-0.5 rounded-md border transition-colors min-h-[28px]",
                    isSnoozed
                      ? "border-violet-500/30 bg-violet-500/[0.08] text-violet-200"
                      : "border-[var(--border-default)]/60 bg-[var(--bg-raised)]/[0.04] text-[var(--text-tertiary)] hover:text-[var(--gold)] hover:border-[var(--gold)]/30",
                  )}
                >
                  <Clock size={9} strokeWidth={2} />
                  {isSnoozed
                    ? `until ${formatSnoozedHint(snoozedUntil!)}`
                    : "snooze"}
                </button>
                {snoozeOpen && (
                  <span
                    role="menu"
                    aria-label="snooze options"
                    className="absolute z-30 top-[110%] left-0 w-44 rounded-md border border-[var(--border-default)] bg-[var(--bg-raised)] shadow-lg overflow-hidden"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={async () => {
                        setBusy("snooze");
                        setSnoozeOpen(false);
                        try {
                          await onSnooze(task.id, tomorrow6am());
                        } finally {
                          setBusy(null);
                        }
                      }}
                      className="block w-full text-left px-3 py-2 text-[11px] font-mono uppercase tracking-[0.15em] text-[var(--text-secondary)] hover:bg-[var(--gold)]/[0.06] hover:text-[var(--gold)]"
                    >
                      ↪ tomorrow · 6am
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={async () => {
                        setBusy("snooze");
                        setSnoozeOpen(false);
                        try {
                          await onSnooze(task.id, nextMonday6am());
                        } finally {
                          setBusy(null);
                        }
                      }}
                      className="block w-full text-left px-3 py-2 text-[11px] font-mono uppercase tracking-[0.15em] text-[var(--text-secondary)] hover:bg-[var(--gold)]/[0.06] hover:text-[var(--gold)] border-t border-[var(--border-default)]/40"
                    >
                      ↪ next mon · 6am
                    </button>
                    {isSnoozed && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={async () => {
                          setBusy("snooze");
                          setSnoozeOpen(false);
                          try {
                            // Pass empty string · parent normalizes to null
                            // via the validator (snoozedUntil: nullableDate).
                            await onSnooze(task.id, "");
                          } finally {
                            setBusy(null);
                          }
                        }}
                        className="block w-full text-left px-3 py-2 text-[11px] font-mono uppercase tracking-[0.15em] text-rose-300 hover:bg-rose-500/[0.06] border-t border-[var(--border-default)]/40"
                      >
                        × clear snooze
                      </button>
                    )}
                  </span>
                )}
              </span>
            )}
            {task.energyRequired && <span>{task.energyRequired} energy</span>}
            {task.effort && <span>{task.effort}</span>}
            {dueHint && <span>{dueHint}</span>}
          </div>
        )}
        {/* Suggest-then-approve · a parked LOW-confidence mission match waits
         *  here for the operator to attach or dismiss (set by enrichTaskLinkage). */}
        {(task as unknown as { pendingClassification?: unknown })
          .pendingClassification != null && (
          <TaskPendingClassificationChip
            taskId={task.id}
            pending={
              (task as unknown as { pendingClassification?: unknown })
                .pendingClassification
            }
          />
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
          {/* Wave AJ · 2026-05-28 · task reorder · operator's missing
           *  resort affordance · ↑/↓ swap rank with neighbor · arrows
           *  fade at the ends to signal terminal position.
           *  Wave AT · 2026-05-28 · always-on background tint + grouping
           *  border so the buttons read as tappable at rest on mobile.
           *  Pre-this-fix the icons were color-tertiary at idle and only
           *  lit up on hover — invisible on touch. Matches the
           *  MissionCard mission-reorder polish from this wave. */}
          {onMove && (canMoveUp || canMoveDown) && (
            <span className="inline-flex rounded-md border border-[var(--border-default)]/60 bg-[var(--bg-raised)]/[0.06] overflow-hidden">
              <button
                type="button"
                onClick={() => {
                  if (canMoveUp) onMove(task.id, "up");
                }}
                disabled={!canMoveUp}
                aria-label="move up"
                title="move up"
                className={cn(
                  "inline-flex h-11 w-8 items-center justify-center transition-transform active:scale-95",
                  canMoveUp
                    ? "text-[var(--text-secondary)] hover:text-[var(--gold)] hover:bg-[var(--gold)]/[0.08]"
                    : "text-[var(--text-tertiary)]/30 cursor-not-allowed",
                )}
              >
                <ArrowUp size={12} strokeWidth={2} />
              </button>
              <span
                aria-hidden
                className="w-px bg-[var(--border-default)]/60"
              />
              <button
                type="button"
                onClick={() => {
                  if (canMoveDown) onMove(task.id, "down");
                }}
                disabled={!canMoveDown}
                aria-label="move down"
                title="move down"
                className={cn(
                  "inline-flex h-11 w-8 items-center justify-center transition-transform active:scale-95",
                  canMoveDown
                    ? "text-[var(--text-secondary)] hover:text-[var(--gold)] hover:bg-[var(--gold)]/[0.08]"
                    : "text-[var(--text-tertiary)]/30 cursor-not-allowed",
                )}
              >
                <ArrowDown size={12} strokeWidth={2} />
              </button>
            </span>
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

/** Wave AV · 2026-05-28 · compact snooze-pill label. The pill is tiny
 *  so we lean on weekday-name + day-of-month rather than a full date. */
function formatSnoozedHint(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "?";
  const now = new Date();
  const msPerDay = 1000 * 60 * 60 * 24;
  const days = Math.round((d.getTime() - now.getTime()) / msPerDay);
  if (days === 0) return "tonight";
  if (days === 1) return "tomorrow";
  if (days < 7)
    return d.toLocaleDateString("en-US", { weekday: "short" }).toLowerCase();
  return d
    .toLocaleDateString("en-US", { month: "short", day: "numeric" })
    .toLowerCase();
}
