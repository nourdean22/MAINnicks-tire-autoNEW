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
import { Sparkles, Target, Repeat, ArrowRight, Play, Check, X, Timer, Coffee, Wind } from "lucide-react";
import { TipChip } from "@/components/ui/tip-chip";
import type { Task } from "@/components/actions/shared";
import { useMoveFrame } from "@/hooks/use-move-frame";
import { useWorkAnchor } from "@/hooks/use-work-anchor";
import { useIdleDetector } from "@/hooks/use-idle-detector";
import { useMissionMode } from "@/hooks/mastery/use-mission-mode";
import { useSwipeGesture } from "@/hooks/use-swipe-gesture";

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
  /** Phase 3 · count of tasks completed today · drives the chain
   *  visualization in the footer. Optional · footer self-hides
   *  when count is 0 AND no streak is active. */
  doneTodayCount?: number;
  /** Phase 7 lite · when true, MoveFrame replaces NOW with a Recovery
   *  Crescendo affordance · breath prompt + smallest task suggestion.
   *  Drives off nourState.currentState === "drift" at the page layer. */
  isDrifting?: boolean;
}

export function MoveFrame({
  tasks,
  onFocus,
  onStart,
  onComplete,
  doneTodayCount = 0,
  isDrifting = false,
}: MoveFrameProps) {
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

  // Phase 9 lite · mission-mode visual indicator. When ?missionId=X
  // is in URL, the page-level tRPC fetch (page.tsx) ALREADY filters
  // tasks to that mission. This hook reads the same URL state to show
  // a "MISSION · {title}" chip in the header so the operator sees
  // the visual shift, not just the filtered list.
  const missionMode = useMissionMode();

  if (isEmpty) return null;

  return (
    <section
      aria-label="move frame"
      className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-raised)]/[0.03] p-3 sm:p-4 space-y-3"
    >
      <header className="flex items-center gap-2 flex-wrap">
        <Sparkles size={13} className="text-[var(--gold)]" strokeWidth={1.75} />
        <h2 className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--gold)]">
          move frame
        </h2>
        <span className="text-[10px] font-mono tabular-nums text-[var(--text-tertiary)]">
          {missionMode.active ? "· mission filter active" : "· the move spread"}
        </span>
        {/* Phase 9 lite · mission chip when filter is active. Operator
         *  sees WHICH mission narrowed the move spread without needing
         *  to scroll up to MissionBreadcrumb. The page already filters
         *  tasks at the tRPC layer (page.tsx) · this is just visual. */}
        {missionMode.active && missionMode.mission && (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-[var(--gold)]/40 bg-[var(--gold)]/[0.08] px-2 py-0.5 text-[9px] font-mono uppercase tracking-[0.18em] text-[var(--gold)]"
            data-mission-chip
          >
            <span aria-hidden>✦</span>
            <span className="truncate max-w-[140px]">{missionMode.mission.title}</span>
          </span>
        )}
        <TipChip tip={TIP} title="move frame" size="xs" />
      </header>

      {/* Phase 7 lite · Recovery Crescendo · 2026-05-26. When the
       *  operator is in drift state (per useNourState), replace the
       *  NOW card with a calmer affordance: breath prompt + smallest
       *  task suggestion. Drift→flow is tracked separately via the
       *  Coach Channel (queued for follow-up). */}
      {isDrifting ? (
        <RecoveryCrescendoCard
          smallestTask={pickSmallestTask(visibleTasks)}
          onStart={handleStart}
          onComplete={handleComplete}
        />
      ) : now ? (
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

      {/* Phase 3 light · streak chain footer + max-streak chip.
       *  Chain renders ●●●●○ for done-today out of ~5 visible slots.
       *  Max streak comes from the top DAILY card · single source.
       *  Self-hides when no streak + zero done. */}
      <StreakChainFooter
        doneTodayCount={doneTodayCount}
        topDailyStreak={daily?.streakCount ?? 0}
      />
    </section>
  );
}

/* ─── Phase 3 · simple chain visualization · no SVG, no Framer ─── */

interface StreakChainFooterProps {
  doneTodayCount: number;
  topDailyStreak: number;
}

function StreakChainFooter({ doneTodayCount, topDailyStreak }: StreakChainFooterProps) {
  if (doneTodayCount === 0 && topDailyStreak === 0) return null;

  // Chain dots · 5 visible slots · fills left-to-right as the day's
  // done count climbs. Past 5 done, the count number takes over.
  const VISIBLE_SLOTS = 5;
  const filled = Math.min(doneTodayCount, VISIBLE_SLOTS);
  const overflow = doneTodayCount > VISIBLE_SLOTS;

  // Streak milestone tier · per the plan: 4d 🔥 / 7d Started / 30d named
  const milestone =
    topDailyStreak >= 30
      ? { emoji: "🏆", label: `${topDailyStreak}d milestone`, tone: "amber" }
      : topDailyStreak >= 7
        ? { emoji: "✨", label: `${topDailyStreak}d streak started`, tone: "gold" }
        : topDailyStreak >= 4
          ? { emoji: "🔥", label: `${topDailyStreak}d streak`, tone: "gold" }
          : topDailyStreak >= 1
            ? { emoji: "🌱", label: `${topDailyStreak}d growing`, tone: "muted" }
            : null;

  return (
    <div className="mt-1 flex items-center justify-between gap-3 px-1 text-[10px] font-mono">
      <div className="flex items-center gap-1.5">
        <span className="text-[var(--text-tertiary)] uppercase tracking-[0.18em]">today</span>
        <div className="flex items-center gap-[3px]">
          {Array.from({ length: VISIBLE_SLOTS }).map((_, i) => (
            <span
              key={i}
              aria-hidden
              className={[
                "inline-block h-1.5 w-1.5 rounded-full",
                i < filled ? "bg-[var(--gold)]" : "bg-[var(--border-default)]/60",
              ].join(" ")}
            />
          ))}
        </div>
        <span className="text-[var(--text-secondary)] tabular-nums">
          {doneTodayCount} done{overflow ? "+" : ""}
        </span>
      </div>

      {milestone && (
        <div
          className={[
            "flex items-center gap-1 tabular-nums",
            milestone.tone === "amber"
              ? "text-amber-300"
              : milestone.tone === "gold"
                ? "text-[var(--gold)]"
                : "text-[var(--text-tertiary)]",
          ].join(" ")}
        >
          <span aria-hidden>{milestone.emoji}</span>
          <span>{milestone.label}</span>
        </div>
      )}
    </div>
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
  // Phase 6 lite · native swipe gesture on NOW card.
  // Swipe right = Done · swipe left = Skip. Other variants stay
  // tap-only (don't want accidental swipes on NEXT/DAILY cards
  // changing their content during card switch animation).
  const swipe = useSwipeGesture({
    disabled: variant !== "now" || (!onComplete && !onSkip),
    onSwipeRight: onComplete ? () => void onComplete(task.id) : undefined,
    onSwipeLeft: onSkip ? () => onSkip(task.id) : undefined,
  });
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
        // Phase 6 lite · smooth snap when swipe releases without
        // crossing threshold. transform updates during drag · CSS
        // transition handles the snap-back.
        swipe.state.isDragging ? "" : "transition-transform duration-200 ease-out",
      ].join(" ")}
      data-move-slot={variant}
      {...swipe.handlers}
      style={{
        ...swipe.handlers.style,
        // Translate during drag · 0 when idle. iOS-PWA-safe.
        transform: swipe.state.dx ? `translateX(${swipe.state.dx}px)` : undefined,
        // Subtle opacity shift past the threshold so operator feels
        // "this is about to fire" · 80px threshold → fade to ~80%.
        opacity:
          variant === "now" && Math.abs(swipe.state.dx) > 40
            ? Math.max(0.7, 1 - Math.abs(swipe.state.dx) / 400)
            : undefined,
      }}
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
        href={`/missions?focus=${encodeURIComponent(task.id)}`}
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

      {/* Phase 6 lite · swipe hint · only on NOW + only when swipe is
       *  available (operator hasn't moved yet · isDragging false).
       *  Mobile-first affordance · desktop just sees the static hint. */}
      {variant === "now" && (onComplete || onSkip) && !swipe.state.isDragging && (
        <p
          aria-hidden
          className="absolute right-3 top-3 text-[8px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]/40 select-none pointer-events-none"
        >
          ← skip · done →
        </p>
      )}

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

/* ─── Phase 7 lite · Recovery Crescendo · drift-mode affordance ─── */

interface RecoveryCrescendoCardProps {
  smallestTask: Task | null;
  onStart?: (taskId: string) => void | Promise<void>;
  onComplete?: (taskId: string) => void | Promise<void>;
}

function RecoveryCrescendoCard({
  smallestTask,
  onStart,
  onComplete,
}: RecoveryCrescendoCardProps) {
  return (
    <div className="relative rounded-lg border border-sky-400/30 bg-sky-500/[0.04] p-4">
      <span
        aria-hidden
        className="absolute left-0 top-0 bottom-0 w-[2px] rounded-l-lg bg-sky-400/70"
      />

      <div className="flex items-center gap-2 mb-2">
        <Wind size={12} className="text-sky-300" strokeWidth={1.75} />
        <span className="text-[9px] font-mono uppercase tracking-[0.18em] text-sky-300/80">
          recovery crescendo · drift detected
        </span>
      </div>

      <p className="text-[12px] text-[var(--text-secondary)] leading-snug mb-3">
        Breathe. Pick the smallest possible move · the chain restarts from one.
      </p>

      {smallestTask ? (
        <>
          <div className="rounded-md border border-[var(--border-default)] bg-[var(--bg-raised)]/[0.08] px-3 py-2.5 mb-2.5">
            <p className="text-[12px] font-medium text-[var(--text-primary)] leading-snug">
              {smallestTask.title}
            </p>
            {smallestTask.effort && (
              <p className="mt-1 text-[10px] font-mono uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
                {smallestTask.effort} · smallest available
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {onStart && smallestTask.status !== "DOING" && (
              <ActionButton
                icon={<Play size={11} strokeWidth={2} className="fill-current" />}
                label="Start small"
                onClick={() => void onStart(smallestTask.id)}
                variant="primary"
                aria-label="start the smallest task"
              />
            )}
            {onComplete && (
              <ActionButton
                icon={<Check size={12} strokeWidth={2.25} />}
                label="Done"
                onClick={() => void onComplete(smallestTask.id)}
                variant="success"
                aria-label="mark smallest task complete"
              />
            )}
          </div>
        </>
      ) : (
        <p className="text-[11px] text-[var(--text-tertiary)] italic">
          no tasks queued · capture one with ⌘K when you're ready
        </p>
      )}
    </div>
  );
}

/** Phase 7 lite · pick the task with the smallest declared effort.
 *  Effort values are like "M5" / "M15" / "M30" / "M60" · parses the
 *  number after M. Tasks without an effort hint sort last. Falls
 *  back to the first task when no effort tags exist at all. */
function pickSmallestTask(tasks: Task[]): Task | null {
  const HIDDEN = new Set(["DONE", "ARCHIVED", "DELETED"]);
  const active = tasks.filter((t) => !HIDDEN.has(t.status));
  if (active.length === 0) return null;
  const parseEffort = (e: string | undefined): number => {
    if (!e) return Number.POSITIVE_INFINITY;
    const match = /M(\d+)/.exec(e);
    return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
  };
  const sorted = [...active].sort((a, b) => parseEffort(a.effort) - parseEffort(b.effort));
  return sorted[0] ?? null;
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
