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

import { useCallback, useMemo } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { trpc } from "@/lib/trpc/client";

// Phase AAA (2026-05-19 AM) · Mastery Polyhedron · 8-axis self-model
// as a deformable octahedron · vertex distance from center = score.
// Lazy-loaded so three.js + R3F + drei only ship in the /goals route
// bundle. `ssr: false` avoids hydration mismatch on Canvas mount
// (WebGL context is client-only).
const MasteryPolyhedron = dynamic(
  () => import("@/components/goals/mastery-polyhedron"),
  {
    ssr: false,
    loading: () => (
      <div
        className="w-full rounded-lg border border-[var(--border-default)]"
        style={{ height: 280, background: "#0A0A0A" }}
        aria-hidden="true"
      />
    ),
  },
);
import { MasteryErrorView } from "@/components/mastery/mastery-error-view";
import { MasterySkeleton } from "@/components/mastery/mastery-skeleton";
import { MasterySectionLabel } from "@/components/mastery/mastery-section-label";
// Phase E (2026-05-18 PM) · OperatorPulse · trailing-axis + 7d shape +
// dormant-goal drift. Mounts right under the header so the operator
// sees the forward-looking story BEFORE the static ladder.
import { OperatorPulse } from "@/components/operator/operator-pulse";
// Phase G (2026-05-18 PM) · CompoundChain · 7d task→goal→axis chain ·
// "this week per goal · which tasks moved you". Mounts BELOW the
// pulse + above the ladder so the operator sees recent compounding
// before the static future-goal view.
import { CompoundChain } from "@/components/operator/compound-chain";
// TRACK consolidation (2026-05-21) · recent AI-enriched task insights,
// grouped by 8-axis · rehomed here from the deleted /tasks TRACK tab.
import { RecentInsightsPanel } from "@/components/brain/recent-insights-panel";
import { CoachEventBanner } from "@/components/mastery/coach-event-banner";
import { MissionBreadcrumb } from "@/components/mastery/mission-breadcrumb";
import { MasteryContextDrawer } from "@/components/mastery/mastery-context-drawer";
import { NickSidePane } from "@/components/mastery/nick-side-pane";
// KommandoShell dismantle · Phase 2 (2026-05-21) · the goal-authoring
// surface — was the PLAN tab of the /tasks KommandoShell (KommandoPlan
// in components/actions/mode-plan.tsx). Relocated + trimmed to
// components/goals/goal-board.tsx · it REPLACES the read-only <Ladder>
// below so /goals becomes the place goals are actually created, coached,
// paced + planned. Self-fetches via GET /api/goals (independent of the
// goalsSnapshot query that still feeds the header axes + missions rail).
import { GoalBoard } from "@/components/goals/goal-board";

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

// `ladder` mirrors the trpc.operator.goalsSnapshot response shape ·
// the server still groups goals by horizon. The read-only <Ladder>
// renderer that consumed it was removed (2026-05-21 · replaced by the
// interactive <GoalBoard>), so the field is carried for type-accuracy
// of the snapshot but no longer rendered on this page.
interface Snapshot {
  ladder: Record<Horizon, GoalRow[]>;
  missions: MissionRow[];
  axes: AxisScore[];
  pruneCandidates: number;
  fetchedAt: string;
}

export default function GoalsPage() {
  // Phase OO (2026-05-19 AM) · tRPC migration · types flow from
  // `lib/services/goals-snapshot.ts` via `trpc.operator.goalsSnapshot`
  // · the manual `Snapshot` interface stays for component-level
  // composition (lots of child components reference it) but the
  // server boundary is now type-safe end-to-end.
  const goalsQuery = trpc.operator.goalsSnapshot.useQuery(undefined, {
    staleTime: 30_000, // matches the prior route's Cache-Control: max-age=30
  });
  const data = goalsQuery.data as Snapshot | undefined;
  const loading = goalsQuery.isLoading;
  const error = goalsQuery.error;
  const reload = () => void goalsQuery.refetch();

  // Phase AAA · scroll to an axis section on Sidebar tap-through ·
  // the polyhedron vertex emits `domain` · Sidebar renders axis rows
  // with `id={`axis-${domain}`}` so the scroll target lines up.
  const onAxisClick = useCallback((domain: string) => {
    if (typeof window === "undefined") return;
    const el = document.getElementById(`axis-${domain}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  if (loading && !data) {
    return <MasterySkeleton cards={3} maxWidth="max-w-6xl" />;
  }
  if (error) return <MasteryErrorView label="Goals" error={error.message} onRetry={reload} />;
  if (!data) return null;

  return (
    <main className="min-h-[100dvh] bg-[var(--bg-base)] text-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        {/* Header · page title + axis badges */}
        <Header axes={data.axes} pruneCandidates={data.pruneCandidates} />

        {/* Mastery Layer Stage D · 2026-05-26 · mission-mode breadcrumb.
         *  Self-hides when ?missionId is absent · zero cost otherwise. */}
        <div className="mt-4">
          <MissionBreadcrumb />
        </div>

        {/* Mastery Layer Stage A · Coach Channel surface · 2026-05-26.
         *  Reads from /api/coach/events?surface=goals · displays active
         *  coach events (prune-candidate today, more once other writers
         *  migrate). Self-hides when zero events. Polls every 90s with
         *  tab-visibility pause via usePollingFetch. */}
        <div className="mt-6">
          <CoachEventBanner surface="goals" />
        </div>

        {/* Phase AAA (2026-05-19 AM) · Mastery Polyhedron · 8 vertices
            extending from center proportional to each axis score. Tap a
            vertex to focus that axis. A perfectly-balanced operator
            produces a symmetric octahedron · imbalance dents the shape.
            Identity moment for /goals · the first non-generic UI surface
            in NOUR OS that says "this is Nour's OS, not anyone's." */}
        <div className="mt-8">
          <MasteryPolyhedron axes={data.axes} onAxisClick={onAxisClick} />
        </div>

        {/* Phase E (2026-05-18 PM) · OperatorPulse · surface-aware pulse
            line · trailing-axis insight + 7d pace breakdown + oldest
            dormant goal. Self-hides when nothing has signal. */}
        <OperatorPulse surface="goals" className="mt-6 px-0 mx-0" />

        {/* Mastery Layer Stage B adoption · 2026-05-26 · collapse deep-
         *  dive bands (compound chain + recent insights) into a per-
         *  surface drawer. MasteryPolyhedron + OperatorPulse + the
         *  channel banners + GoalBoard stay above-fold (HERO). Deep-
         *  dive context goes one tap away. Collapsed by default ·
         *  self-fetching children stay dormant. */}
        <div className="mt-4">
          <MasteryContextDrawer
            surface="goals"
            label="Deep dive"
            hint="compound chain · recent insights"
          >
            <div className="space-y-6">
              {/* Phase G (2026-05-18 PM) · CompoundChain · this week's chain ·
                  which tasks moved which goals · grouped by axis. Reads as
                  a narrative of progress · "this week · 12 tasks · 5 goals ·
                  3 axes moved". Operator sees how the week actually compounded. */}
              <CompoundChain surface="goals" className="px-0 mx-0" />

              {/* TRACK consolidation (2026-05-21) · recent AI-enriched task
                  insights grouped by 8-axis · rehomed from the deleted /tasks
                  TRACK tab. Same conceptual layer as the axis scores + ladder.
                  Self-hides when empty. */}
              <RecentInsightsPanel />
            </div>
          </MasteryContextDrawer>
        </div>

        {/* Main grid · interactive goal board on left · missions +
            mastery sidebar on right (collapses on mobile).
            KommandoShell dismantle · Phase 2 (2026-05-21) · the
            read-only <Ladder> was REPLACED by <GoalBoard> — the
            relocated goal-authoring surface. Goals are now created,
            coached, paced + planned right here instead of behind the
            /tasks PLAN tab. The board self-fetches its own goal data;
            the read-only missions rail + axis list stay (they read
            from the page's goalsSnapshot query). */}
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-8">
          <GoalBoard />
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
      {/* Phase 5 FULL propagation (2026-05-26) · NickSidePane on /goals.
       *  Multi-turn thread + proactive coach event chips. Per-page
       *  presets bias Nick toward goal-pace / drift / leverage moves
       *  (matches describeFraming() server-side framing). */}
      <NickSidePane
        page="goals"
        coachSurface="goals"
        presets={[
          "Which axis is drifting fastest right now?",
          "Where am I underweighting one goal vs another?",
          "What's the single highest-leverage move this week?",
          "What pace shift would unblock the slowest goal?",
        ]}
      />
    </main>
  );
}

// ── Header · 8 axis badges + page label ─────────────────────────────

function Header({ axes, pruneCandidates }: { axes: AxisScore[]; pruneCandidates: number }) {
  return (
    <header>
      <div className="flex items-baseline justify-between gap-4">
        <div>
          {/* Canonical eyebrow tracking 0.14em + .eyebrow weight ·
              matches /brain, /scoreboard pattern post-2026-05-18 PM
              design-tokens pass (ADR-0015). Pre-pass this used
              tracking-[0.18em] + text-white/40 literal · which the
              audit flagged as drift from the .eyebrow CSS class. */}
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)] mb-1">
            Mastery
          </p>
          <h1 className="text-2xl font-medium text-[var(--text-primary)]">
            Goals
          </h1>
        </div>
        {pruneCandidates > 0 ? (
          <Link
            href={`/chat?q=walk%20me%20through%20pruning%20the%20${pruneCandidates}%20stale%20goals%20Nick%20flagged`}
            className="text-xs px-3 py-2 min-h-[44px] inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/[0.06] text-amber-200 hover:bg-amber-500/[0.12] transition"
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

// ── Sidebar · missions + recent activity ────────────────────────────

// Operator-driven UX correction (2026-05-27): missions section
// removed from /goals · operator's exact words: "the missions should
// be on the tasks page with all the to do items put into the missions
// or organized some way like that. Here, it doesn't do me no good."
// /tasks already hosts <MissionScoreboard /> (task #15) which serves
// the same operational purpose with richer per-mission signal
// (progress · velocity · overdue · stale · deadline columns).
// /goals now focuses on what /goals IS for: the 8-axis mastery model
// + LifeGoals (rendered in the main GoalBoard, not in this sidebar).
//
// `missions` prop kept on the Sidebar interface so the caller's
// `data.missions` plumbing stays type-stable · void-ed below to
// silence unused-param lint.
function Sidebar({ missions, axes }: { missions: MissionRow[]; axes: AxisScore[] }) {
  void missions;
  return (
    <aside className="space-y-8">
      {/* Mastery summary · compact list view */}
      <section className="space-y-3">
        <MasterySectionLabel label="8-axis mastery" />
        {axes.length === 0 ? (
          <p className="text-xs text-[var(--text-tertiary)]">No scores yet.</p>
        ) : (
          <ul className="space-y-2">
            {axes.map((a) => (
              <li
                key={a.domain}
                id={`axis-${a.domain}`}
                className="flex items-center justify-between text-xs scroll-mt-20"
              >
                <span className="text-[var(--text-secondary)]">{a.domain}</span>
                <span className="tabular-nums text-[var(--text-primary)]">
                  {a.score.toFixed(1)}
                  <span
                    className={`ml-2 ${
                      a.delta7d > 0
                        ? "text-emerald-300"
                        : a.delta7d < 0
                        ? "text-red-300"
                        : "text-[var(--text-tertiary)]"
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

// SkeletonView + ErrorView extracted to components/mastery/ on 2026-05-18 ·
// see MasterySkeleton + MasteryErrorView. The 50 LOC of bespoke per-page
// implementations is now ~6 LOC of imports + 3 LOC of usage.
