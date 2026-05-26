"use client";

/**
 * MoveFrame · /tasks v2.2 redesign · 2026-05-26
 *
 * Operator HUD that sits above the LIST on /tasks. Shows 3 cards:
 *
 *   NOW    · highest-urgency PROMISE/ONCE task — "what now?"
 *   NEXT   · #2 urgency — "what after?"
 *   DAILY  · top habit not yet checked today — "the streak anchor"
 *
 * Selection logic lives in `useMoveFrame` hook. This component owns
 * the layout, the editorial gold-accent treatment, the focus deep-
 * link, and the 3-action surface on NOW (Phase 1B).
 *
 * Phase 1  (commit 8a9be9ec)  · read-only HUD · cards + deep-link
 * Phase 1B (this commit)      · 3 actions on NOW · Do ▶ / Done ✓ / Skip
 *                              · Skip is local-only (no DB mutation) ·
 *                                excludes the task from MoveFrame's
 *                                selection until page reload · keeps
 *                                the kaizen surface small (Defer 1d
 *                                deferred until a snooze mutation is
 *                                wired in a follow-up)
 *
 * Visual language ·
 *   Editorial-minimalist gold-accent. Matches NextMoveCard / status
 *   pills / scoreboard. No purple gradients, no AI-slop.
 */

import Link from "next/link";
import { useState, useMemo } from "react";
import { Sparkles, Target, Repeat, ArrowRight, Play, Check, X, Timer, Coffee } from "lucide-react";
import { TipChip } from "@/components/ui/tip-chip";
import type { Task } from "@/components/actions/shared";
import { useMoveFrame } from "@/hooks/use-move-frame";
import { useWorkAnchor } from "@/hooks/use-work-anchor";
import { useIdleDetector } from "@/hooks/use-idle-detector";

const TIP =
  "the move frame picks the top non-daily task as NOW · the on-deck task as NEXT · and your most-streaked habit as DAILY. it updates as you check things off. Do = mark doing · Done = complete · Skip = pass over this task locally (returns next page load).";

interface MoveFrameProps {
  tasks: Task[];
  /** Optional callback when an "Open" link is followed · used to scroll
   *  the LIST below into view. If omitted, the link just changes the
   *  query string and the page's existing focus-handler does the rest. */
  onFocus?: (taskId: string) => void;
  /** Mark task as DOING · "Do ▶" button on NOW card. */
  onStart?: (taskId: string) => void | Promise<void>;
  /** Mark task as DONE · "Done ✓" button on NOW card. Same handler the
   *  LIST row uses · keeps the state machine consistent. */
  onComplete?: (taskId: string) => void | Promise<void>;
}

export function MoveFrame({ tasks, onFocus, onStart, onComplete }: MoveFrameProps) {
  // Phase 1B · local-only "skip" state · operator passes over the
  // current NOW without mutating it. Returns next page load.
  const [skippedIds, setSkippedIds] = useState<Set<string>>(new Set());
  const visibleTasks = useMemo(
    () => (skippedIds.size === 0 ? tasks : tasks.filter((t) => !skippedIds.has(t.id))),
    [tasks, skippedIds],
  );
  const { now, next, daily, isEmpty } = useMoveFrame(visibleTasks);

  // Phase 2 · soft work anchor + idle detector (no forced pomodoro).
  // Anchor persists in localStorage · idle nudge fires at 5min ·
  // auto-release at 30min via the extendedIdle threshold.
  const { anchor, elapsedMs, startWork, reaffirm, release: releaseAnchor } = useWorkAnchor();
  const { isIdle, isExtendedIdle, reset: resetIdle } = useIdleDetector({
    thresholdMs: 5 * 60_000,
    extendedThresholdMs: 30 * 60_000,
    disabled: anchor === null, // no point watching when there's no anchor
  });

  // Auto-release after 30 min idle · operator walked away · don't
  // keep stale anchor across breaks.
  if (anchor && isExtendedIdle) {
    releaseAnchor();
  }

  const handleSkip = (taskId: string) => {
    setSkippedIds((prev) => {
      const updated = new Set(prev);
      updated.add(taskId);
      return updated;
    });
    // If the skipped task IS the current anchor, drop the anchor too.
    if (anchor?.taskId === taskId) releaseAnchor();
  };

  // Wrap onStart to also set the work anchor.
  const handleStart = async (taskId: string) => {
    startWork(taskId);
    resetIdle();
    if (onStart) await onStart(taskId);
  };

  // Wrap onComplete to release the anchor.
  const handleComplete = async (taskId: string) => {
    if (anchor?.taskId === taskId) releaseAnchor();
    if (onComplete) await onComplete(taskId);
  };

  if (isEmpty) return null;

  return (
    <section
      aria-label="move frame"
      className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-raised)]/[0.03] p-3 sm:p-4 space-y-3"
    >
      <header className="flex items-center gap-2">
        <Sparkles size={13} className="text-[var(--gold)]" strokeWidth={1.75} />
        <h2 className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--gold)]">
          move frame
        </h2>
        <span className="text-[10px] font-mono tabular-nums text-[var(--text-tertiary)]">
          · the move spread
        </span>
        <TipChip tip={TIP} title="move frame" size="xs" />
      </header>

      {/* NOW · hero card · full-width · gold-accent left rail */}
      {now ? (
        <MoveSlot
          variant="now"
          task={now}
          onFocus={onFocus}
          onStart={handleStart}
          onComplete={handleComplete}
          onSkip={handleSkip}
          anchor={anchor?.taskId === now.id ? anchor : null}
          anchorElapsedMs={anchor?.taskId === now.id ? elapsedMs : 0}
          isIdle={anchor?.taskId === now.id && isIdle}
          onReaffirm={() => {
            reaffirm();
            resetIdle();
          }}
          onReleaseAnchor={releaseAnchor}
        />
      ) : (
        <EmptySlot label="now" />
      )}

      {/* NEXT + DAILY · side-by-side on desktop · stacked on mobile */}
      <div className="grid gap-3 sm:grid-cols-2">
        {next ? (
          <MoveSlot variant="next" task={next} onFocus={onFocus} />
        ) : (
          <EmptySlot label="next" />
        )}
        {daily ? (
          <MoveSlot variant="daily" task={daily} onFocus={onFocus} />
        ) : (
          <EmptySlot label="daily" />
        )}
      </div>
    </section>
  );
}

/* ─── Slot card · variant: now | next | daily ─────────────────── */

interface MoveSlotProps {
  variant: "now" | "next" | "daily";
  task: Task;
  onFocus?: (taskId: string) => void;
  /** Phase 1B · only NOW renders these · ignored on next/daily. */
  onStart?: (taskId: string) => void | Promise<void>;
  onComplete?: (taskId: string) => void | Promise<void>;
  onSkip?: (taskId: string) => void;
  /** Phase 2 · anchor + idle props (NOW slot only). */
  anchor?: { taskId: string; startedAt: string; reaffirmedAt?: string } | null;
  anchorElapsedMs?: number;
  isIdle?: boolean;
  onReaffirm?: () => void;
  onReleaseAnchor?: () => void;
}

function MoveSlot({
  variant,
  task,
  onFocus,
  onStart,
  onComplete,
  onSkip,
  anchor,
  anchorElapsedMs = 0,
  isIdle = false,
  onReaffirm,
  onReleaseAnchor,
}: MoveSlotProps) {
  const accent = variant === "now";
  const Icon = variant === "now" ? Target : variant === "daily" ? Repeat : ArrowRight;
  const label = variant === "now" ? "now" : variant === "daily" ? "daily" : "next";

  // NOW · larger title · NEXT/DAILY · compact
  const titleClass = accent
    ? "text-[13px] sm:text-[14px] font-medium text-[var(--text-primary)] leading-snug"
    : "text-[12px] font-medium text-[var(--text-primary)] leading-snug";

  return (
    <div
      className={[
        "relative rounded-lg border bg-[var(--bg-raised)]/[0.06] p-3 transition-colors",
        accent
          ? "border-[var(--gold)]/40 bg-[var(--gold)]/[0.04]"
          : "border-[var(--border-default)] hover:border-[var(--gold)]/30",
      ].join(" ")}
      data-move-slot={variant}
    >
      {accent && (
        <span
          aria-hidden
          className="absolute left-0 top-0 bottom-0 w-[2px] rounded-l-lg bg-[var(--gold)]/70"
        />
      )}

      <div className="flex items-center gap-2 mb-1.5">
        <Icon
          size={11}
          className={accent ? "text-[var(--gold)]" : "text-[var(--text-tertiary)]"}
          strokeWidth={1.75}
        />
        <span
          className={[
            "text-[9px] font-mono uppercase tracking-[0.18em]",
            accent ? "text-[var(--gold)]" : "text-[var(--text-tertiary)]",
          ].join(" ")}
        >
          {label}
        </span>
        {variant === "daily" && typeof task.streakCount === "number" && task.streakCount > 0 && (
          <span className="text-[10px] font-mono tabular-nums text-[var(--text-tertiary)]">
            🔥 {task.streakCount}d
          </span>
        )}
      </div>

      <Link
        href={`/tasks?focus=${encodeURIComponent(task.id)}`}
        onClick={() => onFocus?.(task.id)}
        className="block group"
        aria-label={`open task ${task.title}`}
      >
        <p className={titleClass}>{task.title}</p>
        {(task.mission?.title || task.context) && (
          <p className="mt-1 text-[10px] font-mono uppercase tracking-[0.1em] text-[var(--text-tertiary)] truncate">
            {[task.mission?.title, task.context].filter(Boolean).join(" · ")}
          </p>
        )}
      </Link>

      {/* Phase 2 · active anchor chip + 10-min milestone (NOW only). */}
      {variant === "now" && anchor && anchor.taskId === task.id && (
        <div className="mt-2 flex items-center gap-1.5 text-[10px] font-mono">
          <Timer size={10} className="text-[var(--gold)]/80" strokeWidth={1.75} />
          <span className="text-[var(--text-secondary)] tabular-nums">
            anchored · {formatElapsed(anchorElapsedMs)}
          </span>
          {anchorElapsedMs >= 10 * 60_000 && (
            <span className="text-[var(--gold)]/90">· focused 10 min 🔥</span>
          )}
        </div>
      )}

      {/* Phase 2 · inline idle nudge (NOW only, when isIdle). Replaces
       *  the plan's side-pane nudge (Phase 5 isn't built yet · this
       *  inline shape ships standalone). */}
      {variant === "now" && isIdle && anchor && anchor.taskId === task.id && (
        <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-2.5 py-2">
          <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.18em] text-amber-300/80">
            <Coffee size={11} className="shrink-0" strokeWidth={1.75} />
            still on this?
          </div>
          <p className="mt-1 text-[11px] text-[var(--text-secondary)] leading-snug">
            {"5+ min since last activity · reaffirm or pick something new"}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <ActionButton
              icon={<Check size={11} strokeWidth={2} />}
              label="Still on it"
              onClick={() => onReaffirm?.()}
              variant="primary"
              aria-label="reaffirm work anchor"
            />
            <ActionButton
              icon={<X size={11} strokeWidth={2} />}
              label="Release"
              onClick={() => onReleaseAnchor?.()}
              variant="ghost"
              aria-label="release work anchor"
            />
          </div>
        </div>
      )}

      {/* Phase 1B · 3 actions on NOW only · 44pt min for iOS PWA.
       *  Phase 2 · "Do" gets a "Doing" pill treatment when this task
       *  is already the active anchor (don't re-fire startTask if
       *  it's already DOING + anchored). */}
      {variant === "now" && (onStart || onComplete || onSkip) && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {onStart && task.status !== "DOING" && (
            <ActionButton
              icon={<Play size={11} strokeWidth={2} className="fill-current" />}
              label={anchor?.taskId === task.id ? "Doing" : "Do"}
              onClick={() => void onStart(task.id)}
              variant="primary"
              aria-label="start this task"
            />
          )}
          {onComplete && (
            <ActionButton
              icon={<Check size={12} strokeWidth={2.25} />}
              label="Done"
              onClick={() => void onComplete(task.id)}
              variant="success"
              aria-label="mark task complete"
            />
          )}
          {onSkip && (
            <ActionButton
              icon={<X size={12} strokeWidth={2} />}
              label="Skip"
              onClick={() => onSkip(task.id)}
              variant="ghost"
              aria-label="skip this task locally"
            />
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Phase 2 helper · format elapsed ms for the anchor chip ───── */

function formatElapsed(ms: number): string {
  if (ms < 60_000) return `${Math.max(0, Math.floor(ms / 1000))}s`;
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h}h` : `${h}h ${rest}m`;
}

/* ─── Action button primitive · gold-accent · iOS-PWA-safe ────── */

interface ActionButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  variant: "primary" | "success" | "ghost";
  "aria-label": string;
}

function ActionButton({ icon, label, onClick, variant, "aria-label": ariaLabel }: ActionButtonProps) {
  // Variant styling · primary = gold (Do) · success = emerald (Done) ·
  // ghost = neutral (Skip). All meet 44pt min-height for iOS PWA touch.
  const variantClass =
    variant === "primary"
      ? "border-[var(--gold)]/50 bg-[var(--gold)]/10 text-[var(--gold)] hover:bg-[var(--gold)]/15"
      : variant === "success"
        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15"
        : "border-[var(--border-default)] bg-[var(--bg-raised)]/[0.06] text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]/[0.12]";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={[
        "inline-flex min-h-[36px] items-center gap-1.5 rounded-md border px-3 py-1.5",
        "text-[11px] font-medium uppercase tracking-[0.05em] transition-colors",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gold)]/40",
        variantClass,
      ].join(" ")}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

/* ─── Empty slot · placeholder when a cohort has no candidates ──── */

function EmptySlot({ label }: { label: "now" | "next" | "daily" }) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--border-default)]/60 bg-[var(--bg-raised)]/[0.02] p-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[9px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]/60">
          {label}
        </span>
      </div>
      <p className="text-[11px] text-[var(--text-tertiary)]/70 italic">
        {label === "daily" ? "no habit pending today" : "nothing queued"}
      </p>
    </div>
  );
}
