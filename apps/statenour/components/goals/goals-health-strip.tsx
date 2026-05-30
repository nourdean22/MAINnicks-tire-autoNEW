"use client";

/**
 * GoalsHealthStrip · Wave AI Phase 3 · 2026-05-28.
 *
 * The operator's at-a-glance triage strip · one chip per active goal ·
 * color-coded by pace + stall state. Lets the operator scan the board
 * for SECONDS and know which goals are alive, behind, or stalled
 * without reading any titles. Sam-Altman-grade scannability:
 *
 *   ● ● ● · ● ● ● · ● ● · ●
 *   green=on   gold=behind  rose=stalled  emerald=ahead  zinc=blank
 *
 * Tap a chip → smooth-scrolls to that goal's row in GoalBoard (we
 * use `id={`goal-${goal.id}`}` selectors which GoalBoard already
 * applies). Mouse hover · row title appears in a tooltip.
 *
 * Sibling to GoalBoard · NEVER touches its 1410-LOC internals. Reads
 * the same goalsSnapshot data the parent already fetched and passes
 * down · zero additional network. Additive only · removable as one
 * line in /goals page.tsx if it ever stops earning its slot.
 *
 * Selection · all active LifeGoals across all horizons except UNSCOPED
 * (unscoped goals are too noisy for this triage view).
 *
 * Visual budget · single horizontal row · flex-wrap on mobile so the
 * strip stays single-screen even at 20+ goals.
 */

import { Flag } from "lucide-react";
import { cn } from "@/lib/utils";

interface GoalRowSlim {
  id: string;
  title: string;
  horizon: string | null;
  progress: number;
  deadline: string | null;
  daysSinceActivity: number | null;
  pruneCandidate: boolean;
}

interface GoalsHealthStripProps {
  ladder: {
    DAY: GoalRowSlim[];
    WEEK: GoalRowSlim[];
    MONTH: GoalRowSlim[];
    QUARTER: GoalRowSlim[];
    YEAR: GoalRowSlim[];
    LIFE: GoalRowSlim[];
    UNSCOPED: GoalRowSlim[];
  };
}

export type Pace = "ahead" | "on_track" | "behind" | "stalled" | "blank" | "done";

interface GoalDot {
  id: string;
  title: string;
  horizon: string | null;
  pace: Pace;
  progress: number;
  paceGap: number | null;
}

export function classifyPace(g: GoalRowSlim): Pace {
  if (g.progress >= 100) return "done";
  if (g.progress === 0) return "blank";
  if (g.daysSinceActivity !== null && g.daysSinceActivity >= 14)
    return "stalled";
  // Deadline-aware pace check: if there's a deadline, compare actual %
  // vs the linear-interpolation "expected by now" %.
  if (g.deadline) {
    const dl = new Date(g.deadline).getTime();
    const now = Date.now();
    if (!Number.isNaN(dl) && dl > now) {
      // Match TopGoalToday's arcDays heuristic so the two surfaces
      // agree about "pace gap" framing for the same goal.
      const arcDays =
        g.horizon === "DAY" || g.horizon === "WEEK"
          ? 7
          : g.horizon === "MONTH"
            ? 30
            : g.horizon === "QUARTER"
              ? 90
              : 365;
      const daysToDeadline = (dl - now) / 86_400_000;
      const fractionPassed = Math.max(
        0,
        Math.min(1, (arcDays - daysToDeadline) / arcDays),
      );
      const expected = Math.round(fractionPassed * 100);
      const gap = expected - Math.round(g.progress);
      if (gap > 12) return "behind";
      if (gap < -5) return "ahead";
      return "on_track";
    }
  }
  // No deadline · "active" = on_track default · "stale" caught above
  return "on_track";
}

function paceGapNum(g: GoalRowSlim): number | null {
  if (!g.deadline) return null;
  const dl = new Date(g.deadline).getTime();
  const now = Date.now();
  if (Number.isNaN(dl) || dl <= now) return null;
  const arcDays =
    g.horizon === "DAY" || g.horizon === "WEEK"
      ? 7
      : g.horizon === "MONTH"
        ? 30
        : g.horizon === "QUARTER"
          ? 90
          : 365;
  const daysToDeadline = (dl - now) / 86_400_000;
  const fractionPassed = Math.max(
    0,
    Math.min(1, (arcDays - daysToDeadline) / arcDays),
  );
  const expected = Math.round(fractionPassed * 100);
  return expected - Math.round(g.progress);
}

const PACE_STYLE: Record<Pace, { dot: string; ring: string; label: string }> = {
  ahead: {
    dot: "bg-emerald-400",
    ring: "ring-emerald-500/30",
    label: "ahead",
  },
  on_track: {
    dot: "bg-emerald-500",
    ring: "ring-emerald-500/20",
    label: "on track",
  },
  behind: {
    dot: "bg-[var(--gold)]",
    ring: "ring-[var(--gold)]/40",
    label: "behind pace",
  },
  stalled: {
    dot: "bg-rose-500",
    ring: "ring-rose-500/40",
    label: "stalled",
  },
  blank: {
    dot: "bg-zinc-600",
    ring: "ring-zinc-700",
    label: "no progress yet",
  },
  done: {
    dot: "bg-[var(--gold)]/60",
    ring: "ring-[var(--gold)]/30",
    label: "complete",
  },
};

const HORIZON_PRIORITY: Array<keyof GoalsHealthStripProps["ladder"]> = [
  "DAY",
  "WEEK",
  "MONTH",
  "QUARTER",
  "YEAR",
  "LIFE",
];

export function GoalsHealthStrip({ ladder }: GoalsHealthStripProps) {
  const all: GoalDot[] = [];
  for (const h of HORIZON_PRIORITY) {
    for (const g of ladder[h] ?? []) {
      if (g.pruneCandidate) continue;
      all.push({
        id: g.id,
        title: g.title,
        horizon: g.horizon,
        pace: classifyPace(g),
        progress: Math.round(g.progress),
        paceGap: paceGapNum(g),
      });
    }
  }
  if (all.length === 0) return null;

  const counts = {
    ahead: all.filter((g) => g.pace === "ahead").length,
    on_track: all.filter((g) => g.pace === "on_track").length,
    behind: all.filter((g) => g.pace === "behind").length,
    stalled: all.filter((g) => g.pace === "stalled").length,
    blank: all.filter((g) => g.pace === "blank").length,
    done: all.filter((g) => g.pace === "done").length,
  };

  return (
    <section
      aria-label="goals health strip"
      className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] px-4 py-3"
    >
      {/* Eyebrow + count badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <Flag
          size={11}
          className="text-[var(--text-tertiary)]"
          strokeWidth={1.75}
        />
        <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
          board health · {all.length}
        </span>
        <span className="text-[var(--text-tertiary)]/30">·</span>
        {counts.stalled > 0 && (
          <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-rose-300">
            {counts.stalled} stalled
          </span>
        )}
        {counts.behind > 0 && (
          <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-[var(--gold)]">
            {counts.behind} behind
          </span>
        )}
        {counts.on_track + counts.ahead > 0 && (
          <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-emerald-300">
            {counts.on_track + counts.ahead} healthy
          </span>
        )}
      </div>

      {/* Chip row · single tap target per goal · 44pt min · scroll to row */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {all.map((g) => {
          const style = PACE_STYLE[g.pace];
          const subtitle =
            g.pace === "behind" && g.paceGap !== null
              ? `${g.paceGap}p behind`
              : g.pace === "ahead" && g.paceGap !== null
                ? `${Math.abs(g.paceGap)}p ahead`
                : style.label;
          return (
            // Wave AR · 2026-05-28 · chips now navigate · the comment at
            // the top of this file promised it · now the code matches.
            // <a href="#goal-X"> + scroll-mt-24 on the GoalBoard row
            // anchor lands the operator on the right card.
            <a
              key={g.id}
              href={`#goal-${g.id}`}
              title={`${g.title} · ${g.progress}% · ${subtitle}`}
              className={cn(
                "group inline-flex items-center gap-1.5 px-2 py-1 rounded-md",
                "bg-[var(--bg-raised)]/[0.04]",
                "transition-colors hover:bg-[var(--gold)]/10 focus-visible:bg-[var(--gold)]/10 outline-none",
              )}
              aria-label={`${g.title}: ${g.progress}%, ${subtitle}. Jump to goal.`}
            >
              <span
                className={cn(
                  "h-2 w-2 rounded-full ring-2 ring-offset-1 ring-offset-[var(--bg-base)] shrink-0",
                  style.dot,
                  style.ring,
                )}
                aria-hidden
              />
              <span className="text-[10px] font-mono text-[var(--text-tertiary)] truncate max-w-[140px] group-hover:text-[var(--text-primary)] group-focus-visible:text-[var(--text-primary)]">
                {g.title}
              </span>
            </a>
          );
        })}
      </div>
    </section>
  );
}
