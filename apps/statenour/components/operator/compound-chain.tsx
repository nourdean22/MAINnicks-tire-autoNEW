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
import { onDataChanged } from "@/lib/events/data-change";
// Phase J · tRPC migration · CompoundChain now reads via
// trpc.operator.compound · types are inferred from the server router ·
// no more manual CompoundShape mirror that drifts as the server
// composer evolves. The legacy GET /api/operator/compound endpoint
// stays mounted for back-compat callers.
import { trpc } from "@/lib/trpc/client";

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

/** Phase G.2 · forward-looking · open task chain · same shape as
 *  AxisChain but the task list is OPEN, not DONE. */
interface PotentialChain {
  domain: string;
  score: number | null;
  delta7d: number | null;
  scoreboard: { label: string; display: string; href: string | null } | null;
  goals: GoalSegment[];
}

interface CompoundShape {
  surface: CompoundSurface;
  stats: ChainStats;
  axes: AxisChain[];
  /** Phase G.2 · forward-looking chains */
  potential: PotentialChain[];
  /** Phase G.2 · today's DONE tasks without a goalId · uncaptured leverage */
  orphanDoneCount: number;
  composedAt: string;
}

export function CompoundChain({
  surface,
  className,
}: {
  surface: CompoundSurface;
  className?: string;
}) {
  const { data, refetch } = trpc.operator.compound.useQuery(
    { surface },
    { staleTime: 30_000 },
  );

  // Re-fetch on task/goal events so a check-off updates the chain
  // narrative without waiting for the next poll.
  useEffect(() => {
    const off = onDataChanged(
      ["tasks", "goals", "score", "any"],
      () => setTimeout(refetch, 500),
    );
    return off;
  }, [refetch]);

  if (!data) return null;
  const { stats, axes, potential, orphanDoneCount } = data;
  // Phase G.2 · self-hide ONLY when there's nothing in any of the three
  // possible sections (backward chain · forward chain · orphan nudge).
  // Pre-G.2 we hid whenever today's done count was 0 · that was the
  // common case so the chain section never showed.
  const hasBackward = stats.totalTasks > 0;
  const hasForward = potential.length > 0;
  const hasOrphans = orphanDoneCount > 0;
  if (!hasBackward && !hasForward && !hasOrphans) return null;

  return (
    <section
      aria-label={`compound chain · ${surface}`}
      className={[
        "mx-auto max-w-[64ch] px-3 py-3 space-y-5",
        className ?? "",
      ].join(" ")}
    >
      {/* Backward chain · "what compounded in {window}" */}
      {hasBackward ? (
        <div className="space-y-3">
          <header className="flex items-baseline justify-between gap-3">
            <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-fg-tertiary">
              {stats.window} · compounded
            </p>
            <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-fg-tertiary tabular-nums">
              {stats.totalTasks} task{stats.totalTasks === 1 ? "" : "s"} ·{" "}
              {stats.totalGoalsLifted} goal{stats.totalGoalsLifted === 1 ? "" : "s"} ·{" "}
              {stats.totalAxesMoved} ax{stats.totalAxesMoved === 1 ? "is" : "es"}
            </p>
          </header>
          <ul className="space-y-3">
            {axes.map((axis) => (
              <AxisChainRow key={axis.domain} axis={axis} variant="done" />
            ))}
          </ul>
        </div>
      ) : null}

      {/* Forward chain · "if you complete these, here's what compounds" */}
      {hasForward ? (
        <div className="space-y-3">
          <header className="flex items-baseline justify-between gap-3">
            <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-fg-tertiary">
              {hasBackward ? "next · potential" : "potential · ready"}
            </p>
            <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-fg-tertiary tabular-nums">
              {potential.reduce((s, p) => s + p.goals.reduce((g, g2) => g + g2.tasks.length, 0), 0)} open ·{" "}
              {potential.length} ax{potential.length === 1 ? "is" : "es"}
            </p>
          </header>
          <ul className="space-y-3">
            {potential.map((axis) => (
              <AxisChainRow
                key={`potential-${axis.domain}`}
                axis={axis}
                variant="open"
              />
            ))}
          </ul>
        </div>
      ) : null}

      {/* Orphan nudge · DONE in window without a goalId · uncaptured
          leverage · 1-line · gold dot · links to /tasks for linking */}
      {hasOrphans ? (
        <Link
          href="/missions"
          className="block rounded-control transition hover:bg-surface-hover focus-visible:bg-surface-hover"
        >
          <div className="flex items-start gap-2.5 text-sm leading-snug">
            <span
              aria-hidden
              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400"
            />
            <span className="min-w-0 flex-1">
              <span className="mr-2 text-[11px] font-mono uppercase tracking-[0.12em] text-fg-tertiary">
                gap
              </span>
              <span className="text-[var(--text-primary)]">
                {orphanDoneCount} task{orphanDoneCount === 1 ? "" : "s"} done today without a goal link · tag to compound
              </span>
            </span>
          </div>
        </Link>
      ) : null}
    </section>
  );
}

function AxisChainRow({
  axis,
  variant = "done",
}: {
  axis: AxisChain | PotentialChain;
  /** "done" = backward · checkmark glyph · "open" = forward · arrow glyph */
  variant?: "done" | "open";
}) {
  const delta = axis.delta7d ?? 0;
  const deltaStr =
    delta > 0
      ? `↑${delta.toFixed(1)}`
      : delta < 0
        ? `↓${Math.abs(delta).toFixed(1)}`
        : "flat";
  const deltaTone =
    delta > 0
      ? "text-emerald-300"
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
        <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-secondary">
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
              className="ml-auto text-[11px] font-mono uppercase tracking-[0.12em] text-fg-tertiary hover:text-[var(--text-primary)]"
              title={`open ${axis.scoreboard.label}`}
            >
              → {axis.scoreboard.label}
            </Link>
          ) : (
            <span className="ml-auto text-[11px] font-mono uppercase tracking-[0.12em] text-fg-tertiary">
              → {axis.scoreboard.label}
            </span>
          )
        ) : null}
      </div>

      {/* Goals + tasks · indented under the axis */}
      <ul className="pl-4 space-y-1.5 border-l border-edge-subtle">
        {axis.goals.map((goal) => (
          <GoalChainRow key={goal.id} goal={goal} variant={variant} />
        ))}
      </ul>
    </li>
  );
}

function GoalChainRow({
  goal,
  variant = "done",
}: {
  goal: GoalSegment;
  variant?: "done" | "open";
}) {
  const glyph = variant === "open" ? "→" : "✓";
  return (
    <li>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium text-[var(--text-primary)] truncate">
          {goal.title}
        </span>
        <span className="shrink-0 text-[11px] font-mono uppercase tracking-[0.12em] text-fg-tertiary tabular-nums">
          {goal.progress.toFixed(0)}%
        </span>
      </div>
      <ul className="mt-1 pl-3 space-y-0.5 border-l border-edge-subtle">
        {goal.tasks.map((task) => (
          <li
            key={task.id}
            className="flex items-baseline gap-2 text-xs text-[var(--text-secondary)]"
          >
            <span
              aria-hidden
              className="text-[var(--text-tertiary)] shrink-0"
            >
              {glyph}
            </span>
            <span className="truncate min-w-0 flex-1">{task.title}</span>
            {task.effort ? (
              <span className="shrink-0 text-[11px] font-mono tabular-nums text-fg-tertiary">
                {task.effort}m
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </li>
  );
}
