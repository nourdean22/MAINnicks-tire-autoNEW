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
import { GoalsHero } from "@/components/goals/goals-hero";
import { GoalsStatsBand } from "@/components/goals/goals-stats-band";
import { GoalsHealthStrip } from "@/components/goals/goals-health-strip";

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
        <Header pruneCandidates={data.pruneCandidates} />

        {/* Mastery Layer Stage D · 2026-05-26 · mission-mode breadcrumb.
         *  Self-hides when ?missionId is absent · zero cost otherwise. */}
        <div className="mt-4">
          <MissionBreadcrumb />
        </div>

        {/* Sam redesign · 2026-05-29 · HERO · the answer the operator
         *  opens /goals to get: the ONE thing that compounds (brief) +
         *  the ONE goal that needs attention (top goal) + an honest
         *  accountability line on whether that goal is moving. */}
        <div className="mt-6">
          <GoalsHero ladder={data.ladder} />
        </div>

        {/* Sam redesign · 2026-05-29 · relevant-stats band · replaces the
         *  3× redundant 8-axis render (header badges + sidebar list +
         *  polyhedron-as-primary) with ONE decision band: trajectory
         *  (climber/faller) · pace (on/behind/stalled) · the floor
         *  (lowest axis · leverage). All re-derived from this snapshot. */}
        <div className="mt-3">
          <GoalsStatsBand axes={data.axes} ladder={data.ladder} />
        </div>

        {/* Coach Channel surface · prune-candidate + drift events. */}
        <div className="mt-6">
          <CoachEventBanner surface="goals" />
        </div>

        {/* Board triage · one chip per active goal · tap → scroll to its
         *  row in GoalBoard below. Now sits directly above the board. */}
        <div className="mt-6">
          <GoalsHealthStrip ladder={data.ladder} />
        </div>

        {/* The work · GoalBoard is now full-width (the right axis sidebar
         *  was the 3rd redundant 8-axis render · folded into the band). */}
        <div className="mt-4">
          <GoalBoard />
        </div>

        {/* Deep dive · everything that isn't a daily decision lives one
         *  tap away: the 3D self-model (polyhedron) · operator pulse ·
         *  this-week compound chain · recent insights. Collapsed by
         *  default · the lazy 3D + self-fetching children stay dormant
         *  until opened — so the page opens lighter than before too. */}
        <div className="mt-8">
          <MasteryContextDrawer
            surface="goals"
            label="Self-model & deep dive"
            hint="8-axis polyhedron · pulse · compound chain · insights"
          >
            <div className="space-y-6">
              <MasteryPolyhedron axes={data.axes} onAxisClick={onAxisClick} />
              <OperatorPulse surface="goals" className="px-0 mx-0" />
              <CompoundChain surface="goals" className="px-0 mx-0" />
              <RecentInsightsPanel />
            </div>
          </MasteryContextDrawer>
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

function Header({ pruneCandidates }: { pruneCandidates: number }) {
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
    </header>
  );
}

// ── Page-local helpers removed in the 2026-05-29 Sam redesign:
//   · AxisBadge — was the header 8-axis render (#1 of 3); cut.
//   · Sidebar   — was the right-rail 8-axis list (#3 of 3); cut, board
//     is now full-width. Both folded into <GoalsStatsBand>.

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
