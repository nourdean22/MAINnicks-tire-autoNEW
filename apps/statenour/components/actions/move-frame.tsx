"use client";

/**
 * MoveFrame · Phase 1 of /tasks v2.2 redesign · 2026-05-26
 *
 * Operator HUD that sits above the LIST on /tasks. Shows 3 cards:
 *
 *   NOW    · highest-urgency PROMISE/ONCE task — "what now?"
 *   NEXT   · #2 urgency — "what after?"
 *   DAILY  · top habit not yet checked today — "the streak anchor"
 *
 * Selection logic lives in `useMoveFrame` hook. This component owns
 * the layout, the editorial gold-accent treatment, and the focus
 * deep-link that scrolls the underlying list to the selected task.
 *
 * Phase 1 scope (this commit) ·
 *   - Read-only HUD · cards display + deep-link to row in list below
 *   - No action buttons yet · operators still use existing row actions
 *   - Additive on top of existing 5 bands · they coexist
 *
 * Phase 1B follow-up (next commit) ·
 *   - 4 actions on NOW: Do ▶ / Defer 1d / Done ✓ / Skip · wired via
 *     existing task tRPC mutations (extracted from page.tsx)
 *   - Auto-rotate · NEXT slides up into NOW on Done (CSS transition)
 *
 * Visual language ·
 *   Editorial-minimalist gold-accent. Matches NextMoveCard / status
 *   pills / shoreboard. No purple gradients, no AI-slop.
 */

import Link from "next/link";
import { Sparkles, Target, Repeat, ArrowRight } from "lucide-react";
import { TipChip } from "@/components/ui/tip-chip";
import type { Task } from "@/components/actions/shared";
import { useMoveFrame } from "@/hooks/use-move-frame";

const TIP =
  "the move frame picks the top non-daily task as NOW · the on-deck task as NEXT · and your most-streaked habit as DAILY. it updates as you check things off. tap → Open to focus the row in the list below.";

interface MoveFrameProps {
  tasks: Task[];
  /** Optional callback when an "Open" link is followed · used to scroll
   *  the LIST below into view. If omitted, the link just changes the
   *  query string and the page's existing focus-handler does the rest. */
  onFocus?: (taskId: string) => void;
}

export function MoveFrame({ tasks, onFocus }: MoveFrameProps) {
  const { now, next, daily, isEmpty } = useMoveFrame(tasks);

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
        <MoveSlot variant="now" task={now} onFocus={onFocus} />
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
}

function MoveSlot({ variant, task, onFocus }: MoveSlotProps) {
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
    </div>
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
