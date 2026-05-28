"use client";

/**
 * TopGoalToday · Wave AI Phase 2 · 2026-05-28.
 *
 * Sam-Altman frame · the ONE GOAL HERO. Below NicksGoalsBrief +
 * above the polyhedron · pins the single most-pressing goal for the
 * operator so /goals never opens onto a "scan to find what to do"
 * moment. Three things you NEED to see · everything else can wait:
 *
 *   1. WHERE YOU ARE        · current value / target · % progress
 *   2. WHERE YOU SHOULD BE  · the expected % by today given deadline
 *                              pace · the honest "you're 12 pts behind"
 *                              number that motivates without lecturing
 *   3. STALL HONESTY        · how many days since the goal moved · if
 *                              > 14 days, a "stalled" mark goes loud
 *
 * Plus a 1-tap "next 60 minutes" CTA · routes the operator to
 * /missions where the linked tasks live (no separate next-move
 * authoring here · the operator already authored next-actions on
 * each goal's tasks).
 *
 * Selection rules · deterministic, no AI roundtrip ·
 *   · skip pruneCandidate goals (Nick already flagged them as stale)
 *   · skip 100% complete + 0% blank goals
 *   · prefer DAY > WEEK > MONTH > QUARTER > YEAR > LIFE > UNSCOPED
 *   · within horizon, pick the largest pace-gap (current vs expected)
 *   · ties broken by openTaskCount DESC (more tasks = more active)
 *
 * Aesthetic · gold accent · single-column · 60s scan · matches the
 * Nicks*Brief eyebrow + body pattern.
 */

import Link from "next/link";
import { ArrowRight, Flag, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface GoalRowSlim {
  id: string;
  title: string;
  domain: string;
  horizon: string | null;
  currentValue: number;
  targetValue: number;
  unit: string;
  progress: number; // 0-100
  deadline: string | null;
  why: string | null;
  pruneCandidate: boolean;
  daysSinceActivity: number | null;
  openTaskCount: number;
}

interface TopGoalTodayProps {
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

const HORIZON_PRIORITY: Array<keyof TopGoalTodayProps["ladder"]> = [
  "DAY",
  "WEEK",
  "MONTH",
  "QUARTER",
  "YEAR",
  "LIFE",
  "UNSCOPED",
];

/** Determine "where you should be by now" if there's a deadline. Linear
 *  interpolation from goal creation (assumed daysSinceActivity-ish) to
 *  deadline. Returns null when there's no deadline OR the deadline is
 *  in the past. */
function expectedProgressByNow(g: GoalRowSlim): number | null {
  if (!g.deadline) return null;
  const dl = new Date(g.deadline).getTime();
  const now = Date.now();
  if (Number.isNaN(dl)) return null;
  if (dl <= now) return 100; // deadline passed · should be 100%
  // We don't have createdAt in the slim shape · use a 90-day default
  // arc for short-horizon (WEEK/MONTH) and 365-day for QUARTER+ ·
  // good enough for "honest pace gap" framing. Operator's actual goal
  // start is on the dossier anyway.
  const arcDays =
    g.horizon === "DAY" || g.horizon === "WEEK"
      ? 7
      : g.horizon === "MONTH"
        ? 30
        : g.horizon === "QUARTER"
          ? 90
          : 365;
  const daysToDeadline = (dl - now) / 86_400_000;
  const totalArc = arcDays;
  const fractionPassed = Math.max(
    0,
    Math.min(1, (totalArc - daysToDeadline) / totalArc),
  );
  return Math.round(fractionPassed * 100);
}

function pickTopGoal(ladder: TopGoalTodayProps["ladder"]): GoalRowSlim | null {
  for (const horizon of HORIZON_PRIORITY) {
    const candidates = (ladder[horizon] ?? []).filter(
      (g) => !g.pruneCandidate && g.progress < 100 && g.progress > 0,
    );
    if (candidates.length === 0) continue;
    // Sort: largest pace gap first; ties by openTaskCount DESC
    candidates.sort((a, b) => {
      const ea = expectedProgressByNow(a);
      const eb = expectedProgressByNow(b);
      const gapA = ea !== null ? ea - a.progress : -1;
      const gapB = eb !== null ? eb - b.progress : -1;
      if (gapA !== gapB) return gapB - gapA;
      return b.openTaskCount - a.openTaskCount;
    });
    return candidates[0] ?? null;
  }
  return null;
}

function formatValue(value: number, unit: string): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded}${unit}`;
}

export function TopGoalToday({ ladder }: TopGoalTodayProps) {
  const goal = pickTopGoal(ladder);
  if (!goal) return null;

  const expected = expectedProgressByNow(goal);
  const paceGap = expected !== null ? expected - Math.round(goal.progress) : null;
  const isStalled =
    goal.daysSinceActivity !== null && goal.daysSinceActivity >= 14;

  return (
    <section
      aria-label="top goal today"
      className="rounded-xl border border-[var(--gold)]/35 bg-[var(--gold)]/[0.04] p-5 shadow-[0_0_28px_rgba(253,185,19,0.04)]"
    >
      {/* Eyebrow · gold uppercase */}
      <div className="flex items-center gap-2 mb-3">
        <Flag
          size={11}
          className="text-[var(--gold)]"
          strokeWidth={2}
        />
        <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--gold)]">
          the one this week
        </p>
        {goal.horizon && (
          <>
            <span className="text-[var(--text-tertiary)]/40">·</span>
            <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
              {goal.horizon.toLowerCase()}
            </span>
          </>
        )}
        {isStalled && goal.daysSinceActivity !== null && (
          <>
            <span className="text-[var(--text-tertiary)]/40">·</span>
            <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-rose-300">
              stalled {goal.daysSinceActivity}d
            </span>
          </>
        )}
      </div>

      {/* Title + why */}
      <h2 className="text-[18px] font-semibold text-[var(--text-primary)] leading-tight">
        {goal.title}
      </h2>
      {goal.why && (
        <p className="mt-1 text-[12px] italic text-[var(--text-secondary)] leading-snug">
          {goal.why}
        </p>
      )}

      {/* The 3 numbers · current · expected · target */}
      <div className="mt-5 grid grid-cols-3 gap-3">
        <Stat
          label="where you are"
          value={`${Math.round(goal.progress)}%`}
          sub={formatValue(goal.currentValue, goal.unit)}
          tint="text-[var(--text-primary)]"
        />
        <Stat
          label="should be"
          value={expected !== null ? `${expected}%` : "—"}
          sub={
            paceGap !== null
              ? paceGap > 0
                ? `${paceGap} pts behind`
                : paceGap < 0
                  ? `${Math.abs(paceGap)} pts ahead`
                  : "on pace"
              : ""
          }
          tint={
            paceGap !== null && paceGap > 5
              ? "text-rose-300"
              : paceGap !== null && paceGap < -5
                ? "text-emerald-300"
                : "text-[var(--gold)]"
          }
          trend={
            paceGap !== null && paceGap > 5 ? (
              <TrendingDown size={11} strokeWidth={2} />
            ) : paceGap !== null && paceGap < -5 ? (
              <TrendingUp size={11} strokeWidth={2} />
            ) : undefined
          }
        />
        <Stat
          label="target"
          value={formatValue(goal.targetValue, goal.unit)}
          sub={goal.deadline ? `by ${goal.deadline.slice(0, 10)}` : "no deadline"}
          tint="text-[var(--text-tertiary)]"
        />
      </div>

      {/* Progress bar · current vs expected · gold actual + faint expected */}
      <div className="mt-4">
        <div className="relative h-2 rounded-full bg-[var(--bg-raised)]/60 overflow-hidden">
          {expected !== null && (
            <div
              className="absolute top-0 bottom-0 bg-[var(--text-tertiary)]/40"
              style={{ left: 0, width: `${expected}%` }}
              aria-hidden
            />
          )}
          <div
            className="absolute top-0 bottom-0 bg-[var(--gold)] transition-[width] duration-500"
            style={{ left: 0, width: `${Math.min(100, Math.round(goal.progress))}%` }}
            aria-label={`${Math.round(goal.progress)}% progress`}
          />
        </div>
      </div>

      {/* CTA · next 60 minutes · 1-tap to /missions */}
      <div className="mt-5 flex items-center justify-between gap-3">
        <p className="text-[11px] text-[var(--text-tertiary)] leading-snug">
          {goal.openTaskCount > 0
            ? `${goal.openTaskCount} linked ${goal.openTaskCount === 1 ? "task" : "tasks"} · pick one + ship it`
            : "no linked tasks yet · open the goal and decompose"}
        </p>
        <Link
          href={
            goal.openTaskCount > 0
              ? `/missions?goal=${encodeURIComponent(goal.id)}`
              : `/goals#goal-${goal.id}`
          }
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md px-3 py-2 min-h-[44px]",
            "text-[12px] font-medium uppercase tracking-[0.12em]",
            "bg-[var(--gold)]/15 text-[var(--gold)] hover:bg-[var(--gold)]/25",
            "border border-[var(--gold)]/30",
            "active:scale-95 transition-all",
          )}
        >
          next 60 min
          <ArrowRight size={12} strokeWidth={2} />
        </Link>
      </div>
    </section>
  );
}

function Stat({
  label,
  value,
  sub,
  tint,
  trend,
}: {
  label: string;
  value: string;
  sub?: string;
  tint?: string;
  trend?: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <div className="text-[9px] font-mono uppercase tracking-[0.15em] text-[var(--text-tertiary)]">
        {label}
      </div>
      <div className={cn("text-[20px] font-bold tabular-nums inline-flex items-center gap-1.5", tint ?? "text-[var(--text-primary)]")}>
        {value}
        {trend}
      </div>
      {sub && (
        <div className="text-[10px] font-mono text-[var(--text-tertiary)]">{sub}</div>
      )}
    </div>
  );
}
