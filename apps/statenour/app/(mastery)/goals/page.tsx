"use client";

/**
 * /goals · Phase A.1 (2026-05-17)
 *
 * The merged goals + missions + mastery-axis surface.
 * Replaces /plan and /mastery. Per ADR-0010 + brainstorm Decision Log.
 *
 * Shape:
 *   · LADDER · LifeGoal grouped by horizon · DAY (hero · top) →
 *     WEEK → MONTH → QUARTER → YEAR → LIFE. Each rung shows progress
 *     bar + axis tag + open-task count + pruner-flag if Nick flagged.
 *   · SIDEBAR (right rail) · 8 mastery-axis badges (top) + active
 *     missions (below). Always visible · the WORK alongside the WHY.
 *   · PRUNER STRIP · banner at top of ladder when Nick has stale
 *     candidates · "N goals haven't moved in 30+ days · review now"
 *     deep-links to chat with seeded context.
 *
 * Aesthetic: editorial-minimalist · gold (#FDB913) for hero accents ·
 * white space dominant · zero gradients · matches Customer 360 + /voice.
 *
 * Mobile: sidebar collapses to a bottom drawer · ladder stays primary.
 *
 * See: ADR-0010 · lib/services/goals-snapshot.ts · app/api/goals/snapshot
 */

import { useMemo } from "react";
import Link from "next/link";
import { useAuthedFetch } from "@/hooks/use-authed-fetch";
import { MasteryErrorView } from "@/components/mastery/mastery-error-view";
import { MasterySkeleton } from "@/components/mastery/mastery-skeleton";

type Horizon = "DAY" | "WEEK" | "MONTH" | "QUARTER" | "YEAR" | "LIFE" | "UNSCOPED";

interface GoalRow {
  id: string;
  title: string;
  domain: string;
  horizon: Horizon | null;
  metric: string;
  targetValue: number;
  currentValue: number;
  unit: string;
  progress: number;
  status: string;
  deadline: string | null;
  why: string | null;
  pruneCandidate: boolean;
  daysSinceActivity: number | null;
  openTaskCount: number;
}

interface MissionRow {
  id: string;
  title: string;
  domain: string;
  status: string;
  priority: number;
  roiScore: number;
  neglectCost: number;
  successMetric: string | null;
  deadline: string | null;
  openTaskCount: number;
}

interface AxisScore {
  domain: string;
  score: number;
  delta7d: number;
  asOf: string;
}

interface Snapshot {
  ladder: Record<Horizon, GoalRow[]>;
  missions: MissionRow[];
  axes: AxisScore[];
  pruneCandidates: number;
  fetchedAt: string;
}

const ORDER: Horizon[] = ["DAY", "WEEK", "MONTH", "QUARTER", "YEAR", "LIFE"];

const HORIZON_LABEL: Record<Horizon, string> = {
  DAY: "Today",
  WEEK: "This Week",
  MONTH: "This Month",
  QUARTER: "This Quarter",
  YEAR: "This Year",
  LIFE: "Life",
  UNSCOPED: "Unscoped",
};

// Hero is biggest · subsequent rungs taper in visual weight
const HORIZON_STYLE: Record<Horizon, { titleSize: string; opacity: string; padding: string }> = {
  DAY: { titleSize: "text-2xl", opacity: "opacity-100", padding: "py-6" },
  WEEK: { titleSize: "text-xl", opacity: "opacity-95", padding: "py-5" },
  MONTH: { titleSize: "text-lg", opacity: "opacity-90", padding: "py-5" },
  QUARTER: { titleSize: "text-lg", opacity: "opacity-85", padding: "py-4" },
  YEAR: { titleSize: "text-base", opacity: "opacity-80", padding: "py-4" },
  LIFE: { titleSize: "text-base", opacity: "opacity-75", padding: "py-4" },
  UNSCOPED: { titleSize: "text-sm", opacity: "opacity-60", padding: "py-3" },
};

export default function GoalsPage() {
  // Phase D follow-up audit (2026-05-18) · collapsed 23 LOC of
  // bespoke fetch+state mgmt to the shared useAuthedFetch hook ·
  // pairs with MasteryErrorView + MasterySkeleton primitives ·
  // matches the convention now used by /scoreboard + the 3
  // /journal thread components.
  const { data, error, loading, reload } = useAuthedFetch<Snapshot>(
    "/api/goals/snapshot",
  );

  if (loading && !data) {
    return <MasterySkeleton cards={3} maxWidth="max-w-6xl" />;
  }
  if (error) return <MasteryErrorView label="Goals" error={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <main className="min-h-[100dvh] bg-[#0A0A0A] text-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        {/* Header · page title + axis badges */}
        <Header axes={data.axes} pruneCandidates={data.pruneCandidates} />

        {/* Main grid · ladder on left · sidebar on right (collapses on mobile) */}
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-8">
          <Ladder ladder={data.ladder} />
          <Sidebar missions={data.missions} axes={data.axes} />
        </div>

        {/* Meta · footer · fetched timestamp */}
        <p className="mt-12 text-[10px] uppercase tracking-[0.22em] text-white/30">
          snapshot · {new Date(data.fetchedAt).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
          })}
        </p>
      </div>
    </main>
  );
}

// ── Header · 8 axis badges + page label ─────────────────────────────

function Header({ axes, pruneCandidates }: { axes: AxisScore[]; pruneCandidates: number }) {
  return (
    <header>
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-white/40 mb-1">
            Mastery
          </p>
          <h1 className="text-2xl font-medium">Goals</h1>
        </div>
        {pruneCandidates > 0 ? (
          <Link
            href={`/chat?q=walk%20me%20through%20pruning%20the%20${pruneCandidates}%20stale%20goals%20Nick%20flagged`}
            className="text-xs px-3 py-2 rounded-full border border-amber-500/40 bg-amber-500/[0.06] text-amber-200 hover:bg-amber-500/[0.12] transition"
          >
            {pruneCandidates} stale · review →
          </Link>
        ) : null}
      </div>
      {/* Axis badges */}
      {axes.length > 0 ? (
        <div className="mt-6 flex flex-wrap gap-2">
          {axes.map((a) => (
            <AxisBadge key={a.domain} axis={a} />
          ))}
        </div>
      ) : null}
    </header>
  );
}

function AxisBadge({ axis }: { axis: AxisScore }) {
  const score = Math.round(axis.score * 10) / 10;
  const tone =
    score >= 7
      ? "border-emerald-400/30 text-emerald-200"
      : score >= 4
      ? "border-white/15 text-white/80"
      : "border-red-400/30 text-red-200";
  const deltaStr =
    axis.delta7d > 0
      ? `↑${axis.delta7d.toFixed(1)}`
      : axis.delta7d < 0
      ? `↓${Math.abs(axis.delta7d).toFixed(1)}`
      : "—";
  return (
    <div
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border ${tone} text-xs`}
      title={`${axis.domain} · score ${score} · 7d ${deltaStr}`}
    >
      <span className="uppercase tracking-wider text-[10px] opacity-70">
        {axis.domain}
      </span>
      <span className="font-medium tabular-nums">{score.toFixed(1)}</span>
      <span className="opacity-60 text-[10px] tabular-nums">{deltaStr}</span>
    </div>
  );
}

// ── Ladder · Day hero top → Life at bottom ──────────────────────────

function Ladder({ ladder }: { ladder: Snapshot["ladder"] }) {
  // Render order: ORDER list (Day → Life), then UNSCOPED if any
  const sections: Array<{ horizon: Horizon; goals: GoalRow[] }> = [];
  for (const h of ORDER) {
    if (ladder[h]?.length) sections.push({ horizon: h, goals: ladder[h] });
  }
  if (ladder.UNSCOPED?.length) {
    sections.push({ horizon: "UNSCOPED", goals: ladder.UNSCOPED });
  }
  if (sections.length === 0) {
    return (
      <div className="rounded-lg border border-white/10 p-8 text-center">
        <p className="text-sm text-white/50">No goals yet.</p>
        <Link
          href="/chat?q=help%20me%20set%20a%20goal%20for%20this%20week"
          className="mt-3 inline-block text-xs text-[#FDB913] hover:underline"
        >
          Ask Nick to help set one →
        </Link>
      </div>
    );
  }
  return (
    <section className="space-y-1">
      {sections.map(({ horizon, goals }) => (
        <Rung key={horizon} horizon={horizon} goals={goals} />
      ))}
    </section>
  );
}

function Rung({ horizon, goals }: { horizon: Horizon; goals: GoalRow[] }) {
  const style = HORIZON_STYLE[horizon];
  return (
    <div className={`border-b border-white/5 ${style.padding} ${style.opacity}`}>
      <div className="flex items-baseline justify-between gap-4 mb-3">
        <h2 className={`${style.titleSize} font-medium`}>{HORIZON_LABEL[horizon]}</h2>
        <span className="text-[10px] uppercase tracking-[0.18em] text-white/40 tabular-nums">
          {goals.length} {goals.length === 1 ? "goal" : "goals"}
        </span>
      </div>
      <ul className="space-y-2">
        {goals.map((g) => (
          <GoalCard key={g.id} goal={g} />
        ))}
      </ul>
    </div>
  );
}

function GoalCard({ goal }: { goal: GoalRow }) {
  const pct = Math.min(100, Math.max(0, goal.progress));
  const isStale = goal.pruneCandidate;
  return (
    <li
      className={`group rounded-lg border ${
        isStale ? "border-amber-500/30 bg-amber-500/[0.03]" : "border-white/10 bg-white/[0.02]"
      } px-4 py-3 transition hover:bg-white/[0.04]`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium truncate">{goal.title}</p>
            <span className="text-[10px] uppercase tracking-wider text-white/40 border border-white/10 rounded px-1.5 py-0.5">
              {goal.domain}
            </span>
            {isStale ? (
              <Link
                href={`/chat?q=walk%20me%20through%20pruning%20goal%20${encodeURIComponent(goal.title)}`}
                className="text-[10px] uppercase tracking-wider text-amber-300 border border-amber-500/30 rounded px-1.5 py-0.5 hover:bg-amber-500/10"
                title="Nick flagged this · click to review"
              >
                stale
              </Link>
            ) : null}
          </div>
          {goal.why ? (
            <p className="text-xs text-white/50 mt-1 italic line-clamp-1">
              "{goal.why}"
            </p>
          ) : null}
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm tabular-nums text-white/80">
            {formatValue(goal.currentValue, goal.unit)} /{" "}
            {formatValue(goal.targetValue, goal.unit)}
          </div>
          {goal.openTaskCount > 0 ? (
            <Link
              href={`/tasks?goalId=${goal.id}`}
              className="text-[10px] uppercase tracking-wider text-white/40 hover:text-white/70"
            >
              {goal.openTaskCount} task{goal.openTaskCount === 1 ? "" : "s"} →
            </Link>
          ) : (
            <span className="text-[10px] uppercase tracking-wider text-white/30">
              no tasks
            </span>
          )}
        </div>
      </div>
      {/* Progress bar */}
      <div className="mt-3 h-1 bg-white/5 rounded-full overflow-hidden">
        <div
          className="h-full bg-[#FDB913] rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] tabular-nums text-white/40">
        <span>{pct.toFixed(0)}%</span>
        {goal.daysSinceActivity != null ? (
          <span>
            {goal.daysSinceActivity === 0
              ? "today"
              : `${goal.daysSinceActivity}d ago`}
          </span>
        ) : null}
      </div>
    </li>
  );
}

// ── Sidebar · missions + recent activity ────────────────────────────

function Sidebar({ missions, axes }: { missions: MissionRow[]; axes: AxisScore[] }) {
  return (
    <aside className="space-y-8">
      {/* Mastery summary · compact list view */}
      <section>
        <h3 className="text-[10px] uppercase tracking-[0.22em] text-white/40 mb-3">
          8-axis mastery
        </h3>
        {axes.length === 0 ? (
          <p className="text-xs text-white/40">No scores yet.</p>
        ) : (
          <ul className="space-y-2">
            {axes.map((a) => (
              <li key={a.domain} className="flex items-center justify-between text-xs">
                <span className="text-white/70">{a.domain}</span>
                <span className="tabular-nums text-white/90">
                  {a.score.toFixed(1)}
                  <span
                    className={`ml-2 ${
                      a.delta7d > 0
                        ? "text-emerald-300"
                        : a.delta7d < 0
                        ? "text-red-300"
                        : "text-white/30"
                    }`}
                  >
                    {a.delta7d > 0 ? "↑" : a.delta7d < 0 ? "↓" : "—"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Active missions · the WORK */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="text-[10px] uppercase tracking-[0.22em] text-white/40">
            Active missions
          </h3>
          <span className="text-[10px] tabular-nums text-white/40">
            {missions.length}
          </span>
        </div>
        {missions.length === 0 ? (
          <p className="text-xs text-white/40">No active missions.</p>
        ) : (
          <ul className="space-y-2">
            {missions.map((m) => (
              <MissionCard key={m.id} mission={m} />
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}

function MissionCard({ mission }: { mission: MissionRow }) {
  return (
    <li className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2.5 transition hover:bg-white/[0.04]">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium truncate flex-1">{mission.title}</p>
        <span className="text-[10px] uppercase tracking-wider text-white/40 shrink-0">
          P{mission.priority}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between text-[10px] text-white/40">
        <span className="uppercase tracking-wider">{mission.domain}</span>
        {mission.openTaskCount > 0 ? (
          <Link
            href={`/tasks?missionId=${mission.id}`}
            className="hover:text-white/80"
          >
            {mission.openTaskCount} →
          </Link>
        ) : null}
      </div>
    </li>
  );
}

// ── Small primitives ───────────────────────────────────────────────

function formatValue(value: number, unit: string): string {
  if (unit === "$") return `$${value.toLocaleString()}`;
  if (unit === "%") return `${value}%`;
  if (!unit) return value.toLocaleString();
  return `${value.toLocaleString()} ${unit}`;
}

// SkeletonView + ErrorView extracted to components/mastery/ on 2026-05-18 ·
// see MasterySkeleton + MasteryErrorView. The 50 LOC of bespoke per-page
// implementations is now ~6 LOC of imports + 3 LOC of usage.
