"use client";

/**
 * CompoundChain · Phase G (2026-05-18 PM)
 *
 * The "see your work compound" visualization.
 *
 * Most of the operator's surfaces show CURRENT state per layer
 * (tasks · goals · stats · axes) — they never show how those layers
 * actually CHAIN when work happens. This component reads the
 * compound-chain composer's tree and renders it as editorial prose:
 *
 *   Today · 3 tasks compounded
 *
 *   ─ Business · ↑0.3 → Mastery · Business 7.4
 *       ✓ "ship pulse" → Q2 features (7/12)
 *       ✓ "client follow-up" → Q2 features (8/12)
 *
 *   ─ Knowledge · ↑0.1 → Mastery · Knowledge 6.9
 *       ✓ "read Buffett ch3" → Read 24 books (8/24)
 *
 * Mounts on /tasks (today), /goals (this week per goal), and
 * /scoreboard (this anchor's chain). Self-hides when nothing
 * compounded in the window.
 *
 * Aesthetic per docs/aesthetic-principles.md:
 *   · text-[var(--text-primary)] body · text-[var(--text-tertiary)] meta
 *   · gold ONLY on positive delta numbers
 *   · monospace eyebrow labels match OperatorPulse + TodaysCompound
 *   · indented chain (single tab) so the tree reads as a tree
 */

import { useEffect } from "react";
import Link from "next/link";
import { useAuthedFetch } from "@/hooks/use-authed-fetch";
import { onDataChanged } from "@/lib/events/data-change";

type CompoundSurface = "tasks" | "goals" | "scoreboard" | "home";

interface TaskSegment {
  id: string;
  title: string;
  completedAt: string;
  effort: number | null;
}

interface GoalSegment {
  id: string;
  title: string;
  domain: string;
  progress: number;
  tasks: TaskSegment[];
}

interface AxisChain {
  domain: string;
  score: number | null;
  delta7d: number | null;
  scoreboard: { label: string; display: string; href: string | null } | null;
  goals: GoalSegment[];
}

interface ChainStats {
  window: string;
  totalTasks: number;
  totalGoalsLifted: number;
  totalAxesMoved: number;
  totalScoreboardShifts: number;
}

interface CompoundShape {
  surface: CompoundSurface;
  stats: ChainStats;
  axes: AxisChain[];
  composedAt: string;
}

export function CompoundChain({
  surface,
  className,
}: {
  surface: CompoundSurface;
  className?: string;
}) {
  const { data, reload } = useAuthedFetch<CompoundShape>(
    `/api/operator/compound?surface=${surface}`,
  );

  // Re-fetch on task/goal events so a check-off updates the chain
  // narrative without waiting for the next poll.
  useEffect(() => {
    const off = onDataChanged(
      ["tasks", "goals", "score", "any"],
      () => setTimeout(reload, 500),
    );
    return off;
  }, [reload]);

  if (!data) return null;
  if (data.stats.totalTasks === 0) return null;

  const { stats, axes } = data;

  return (
    <section
      aria-label={`compound chain · ${surface}`}
      className={[
        "mx-auto max-w-[64ch] px-3 py-3 space-y-3",
        className ?? "",
      ].join(" ")}
    >
      {/* Headline · "Today · 3 tasks compounded" */}
      <header className="flex items-baseline justify-between gap-3">
        <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
          {stats.window} · compounded
        </p>
        <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)] tabular-nums">
          {stats.totalTasks} task{stats.totalTasks === 1 ? "" : "s"} ·{" "}
          {stats.totalGoalsLifted} goal{stats.totalGoalsLifted === 1 ? "" : "s"} ·{" "}
          {stats.totalAxesMoved} ax{stats.totalAxesMoved === 1 ? "is" : "es"}
        </p>
      </header>

      {/* Chains · grouped by axis */}
      <ul className="space-y-3">
        {axes.map((axis) => (
          <AxisChainRow key={axis.domain} axis={axis} />
        ))}
      </ul>
    </section>
  );
}

function AxisChainRow({ axis }: { axis: AxisChain }) {
  const delta = axis.delta7d ?? 0;
  const deltaStr =
    delta > 0
      ? `↑${delta.toFixed(1)}`
      : delta < 0
        ? `↓${Math.abs(delta).toFixed(1)}`
        : "flat";
  const deltaTone =
    delta > 0
      ? "text-[var(--gold)]"
      : delta < 0
        ? "text-red-300"
        : "text-[var(--text-tertiary)]";

  return (
    <li className="space-y-1.5">
      {/* Axis header · domain · delta · scoreboard echo */}
      <div className="flex items-center gap-2 text-xs">
        <span
          aria-hidden
          className="inline-block h-2 w-px bg-[var(--text-tertiary)]/40"
        />
        <span className="font-mono uppercase tracking-[0.14em] text-[var(--text-secondary)]">
          {axis.domain}
        </span>
        {axis.score != null ? (
          <span className="tabular-nums text-[var(--text-tertiary)]">
            {axis.score.toFixed(1)}/10
          </span>
        ) : null}
        <span className={`tabular-nums ${deltaTone}`}>{deltaStr}</span>
        {axis.scoreboard ? (
          axis.scoreboard.href ? (
            <Link
              href={axis.scoreboard.href}
              className="ml-auto text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
              title={`open ${axis.scoreboard.label}`}
            >
              → {axis.scoreboard.label}
            </Link>
          ) : (
            <span className="ml-auto text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
              → {axis.scoreboard.label}
            </span>
          )
        ) : null}
      </div>

      {/* Goals + tasks · indented under the axis */}
      <ul className="pl-4 space-y-1.5 border-l border-white/5">
        {axis.goals.map((goal) => (
          <GoalChainRow key={goal.id} goal={goal} />
        ))}
      </ul>
    </li>
  );
}

function GoalChainRow({ goal }: { goal: GoalSegment }) {
  return (
    <li>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium text-[var(--text-primary)] truncate">
          {goal.title}
        </span>
        <span className="shrink-0 text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)] tabular-nums">
          {goal.progress.toFixed(0)}%
        </span>
      </div>
      <ul className="mt-1 pl-3 space-y-0.5 border-l border-white/5">
        {goal.tasks.map((task) => (
          <li
            key={task.id}
            className="flex items-baseline gap-2 text-xs text-[var(--text-secondary)]"
          >
            <span
              aria-hidden
              className="text-[var(--text-tertiary)] shrink-0"
            >
              ✓
            </span>
            <span className="truncate min-w-0 flex-1">{task.title}</span>
            {task.effort ? (
              <span className="shrink-0 text-[10px] font-mono tabular-nums text-[var(--text-tertiary)]">
                {task.effort}m
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </li>
  );
}
