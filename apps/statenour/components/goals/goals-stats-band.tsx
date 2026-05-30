"use client";

/**
 * GoalsStatsBand · 2026-05-29 · Sam-Altman /goals redesign.
 *
 * Replaces the THREE redundant renders of the 8-axis score (header
 * badges + 3D polyhedron + sidebar list) with ONE decision-driving
 * band. Every stat here is meant to change what the operator does
 * today; the full 8-axis absolute scores live on in the deep-dive
 * polyhedron for when the operator wants the whole self-model.
 *
 * Three signals, all re-derived from the goalsSnapshot the page
 * already fetched — zero new network, zero backend:
 *
 *   TRAJECTORY · the fastest-climbing + fastest-falling axis (delta7d).
 *                two movers, not eight static scores.
 *   PACE       · goals on-pace / behind / stalled (shared classifyPace
 *                so this agrees with TopGoalToday + GoalsHealthStrip).
 *   THE FLOOR  · the lowest axis · the leverage point to raise next.
 *
 * Editorial-minimalist · matches GoalsHealthStrip + the OS gold accent.
 * Self-hides when there's nothing to say.
 */

import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { classifyPace } from "@/components/goals/goals-health-strip";

interface AxisScore {
  domain: string;
  score: number;
  delta7d: number;
  asOf: string;
}

interface GoalSlim {
  id: string;
  title: string;
  horizon: string | null;
  progress: number;
  deadline: string | null;
  daysSinceActivity: number | null;
  pruneCandidate: boolean;
}

interface GoalsStatsBandProps {
  axes: AxisScore[];
  ladder: Record<string, GoalSlim[]>;
}

const MOVE_THRESHOLD = 0.05;

export function GoalsStatsBand({ axes, ladder }: GoalsStatsBandProps) {
  const goals = Object.values(ladder)
    .flat()
    .filter((g) => !g.pruneCandidate);

  // PACE · reuse the single source of pace truth.
  let onPace = 0;
  let behind = 0;
  let stalled = 0;
  for (const g of goals) {
    const p = classifyPace(g);
    if (p === "stalled") stalled++;
    else if (p === "behind") behind++;
    else if (p === "on_track" || p === "ahead") onPace++;
  }

  // TRAJECTORY · biggest 7d climber + faller (only if they actually moved).
  const moved = axes.filter((a) => Math.abs(a.delta7d) >= MOVE_THRESHOLD);
  const climber =
    moved.length > 0
      ? moved.reduce((m, a) => (a.delta7d > m.delta7d ? a : m))
      : null;
  const faller =
    moved.length > 0
      ? moved.reduce((m, a) => (a.delta7d < m.delta7d ? a : m))
      : null;
  const hasClimb = climber !== null && climber.delta7d > 0;
  const hasFall = faller !== null && faller.delta7d < 0;

  // THE FLOOR · lowest axis · the next leverage point.
  const floor =
    axes.length > 0 ? axes.reduce((m, a) => (a.score < m.score ? a : m)) : null;

  if (goals.length === 0 && axes.length === 0) return null;

  return (
    <section
      aria-label="goals stats"
      className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] px-4 py-3"
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* TRAJECTORY */}
        <Cell label="trajectory">
          {hasClimb || hasFall ? (
            <div className="flex flex-col gap-1">
              {hasClimb && climber && (
                <span className="inline-flex items-center gap-1.5 text-[13px] text-emerald-300">
                  <TrendingUp size={12} strokeWidth={2} className="shrink-0" />
                  <span className="capitalize truncate">{climber.domain}</span>
                  <span className="tabular-nums opacity-70 text-[11px]">
                    +{climber.delta7d.toFixed(1)}
                  </span>
                </span>
              )}
              {hasFall && faller && (
                <span className="inline-flex items-center gap-1.5 text-[13px] text-rose-300">
                  <TrendingDown size={12} strokeWidth={2} className="shrink-0" />
                  <span className="capitalize truncate">{faller.domain}</span>
                  <span className="tabular-nums opacity-70 text-[11px]">
                    {faller.delta7d.toFixed(1)}
                  </span>
                </span>
              )}
            </div>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-[13px] text-[var(--text-tertiary)]">
              <Minus size={12} className="shrink-0" /> steady this week
            </span>
          )}
        </Cell>

        {/* PACE */}
        <Cell label="pace">
          <div className="flex items-baseline gap-3 flex-wrap text-[13px]">
            <span className="text-emerald-300 tabular-nums">
              {onPace}
              <span className="ml-1 text-[10px] opacity-70">on pace</span>
            </span>
            {behind > 0 && (
              <span className="text-[var(--gold)] tabular-nums">
                {behind}
                <span className="ml-1 text-[10px] opacity-70">behind</span>
              </span>
            )}
            {stalled > 0 && (
              <span className="text-rose-300 tabular-nums">
                {stalled}
                <span className="ml-1 text-[10px] opacity-70">stalled</span>
              </span>
            )}
          </div>
        </Cell>

        {/* THE FLOOR */}
        <Cell label="the floor">
          {floor ? (
            <span className="text-[13px] text-[var(--text-primary)]">
              <span className="capitalize">{floor.domain}</span>
              <span className="ml-2 tabular-nums text-[var(--text-tertiary)]">
                {floor.score.toFixed(1)}
              </span>
            </span>
          ) : (
            <span className="text-[13px] text-[var(--text-tertiary)]">—</span>
          )}
        </Cell>
      </div>
    </section>
  );
}

function Cell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5 min-w-0">
      <div className="text-[9px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
        {label}
      </div>
      {children}
    </div>
  );
}
