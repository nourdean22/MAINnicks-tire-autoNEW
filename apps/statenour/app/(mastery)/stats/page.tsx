"use client";

/**
 * /stats · 2026-05-30 · the operator's personal stat board.
 *
 * Consolidates the retired /scoreboard + /goals + (Wave 2) /body +
 * /life + the /learn active-loop into ONE personal "me" surface:
 *   ① WHO YOU ARE        · the 33-stat mastery character sheet (leveling)
 *   ② WHERE YOU'RE GOING  · the interactive GoalBoard
 *   ③ BODY                · weight chart + daily health log (was /body)
 *   ④ LEARNING            · the active AI learning loop (KommandoLearn,
 *                           was the bottom of /learn)
 *
 * Wave 2 surface consolidation (2026-06-03): /body folded in as a section,
 * /life DELETED (it was a pure 5-link hub), and the /learn active-learning
 * LOOP moved here. The Build-Your-Own-X tutorial CATALOG stays at /learn
 * (force-static dev reference library — operator call). Redirects:
 * /body → /stats?tab=body · /life → /stats.
 *
 * Per operator (2026-05-30): "business shit belongs on nicks tire admin."
 * Shop/revenue intelligence lives at nickstire.org/admin — this page is
 * about Nour: who he is, what he's climbing toward, his body, his learning.
 *
 * /scoreboard + /goals + /body + /life now 30x-redirect here.
 *
 * Body + Learning are lazy-mounted (next/dynamic · ssr:false) so their
 * recharts weight chart + learning-engine JS stay below the fold and don't
 * tax first paint. Every other child self-fetches + self-hides on its own
 * loading/error, so the page stays light.
 *
 * UI v3 W4 (2026-10-17): three tabs (Mastery; Goals, which now holds Calibration and the forecast
 * duel; Body and learning), a verdict line above them (StatsVerdict), and one state block
 * (StatsStateBlock) for loading, a failed read with Retry, and a real zero, also used while the lazy
 * sections load instead of pulsing blocks. Retired keys ?tab=learning and ?tab=calibration land on
 * the tab holding that section and scroll to it (lib/stats/resolve-tab.ts STATS_TAB_ALIASES).
 * Pinned by tests/components/stats-three-tabs-verdict.test.tsx.
 *
 * Wave E2 (2026-10-24, "am I on track"): the verdict block leads and carries the Journey lens's 30 day
 * trend (the Journey panel at the page bottom is gone); Mastery is one row list (MasteryList) instead
 * of three same-height cards; Goals holds CalibrationTile, PredictionStreaksCard and GhostNickStrip,
 * moved from the Brain Self-model fold. Pinned by tests/components/stats/stats-e2-structure.test.tsx.
 *
 * Suspense boundary: <MissionBreadcrumb> reads useMissionMode() →
 * useSearchParams(), which Next bails to client-side render at prerender
 * time unless wrapped. NickSidePane gets its own so any search-param child
 * there is covered too.
 */

import { Suspense, useEffect, useRef } from "react";
import { STATS_TABS, STATS_TAB_ALIASES, resolveStatsTab } from "@/lib/stats/resolve-tab";
import { StatsStateBlock, StatsVerdict } from "@/components/stats/stats-verdict";
import { scrollBehavior } from "@/lib/ui/scroll-behavior";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { StandardPage } from "@/components/layout/standard-page";
import { MasterySectionLabel } from "@/components/mastery/mastery-section-label";
// 2026-05-30 · the mastery leveling engine's face · every stat as an RPG
// level card + an overall-power hero. Self-hides on error · honest Day-1 zero.
import { CharacterSheet } from "@/components/mastery/character-sheet";
// Level-Up Directive (2026-06-10) · the deterministic "level THIS stat
// today, because X, here's the rep" card. Pure re-rank of data the page
// already fetches (sheet + goals + body) — supersedes the old in-sheet
// "Next rep" strip. Honest "Missing data" empty state; self-hides on
// transient error.
import { LevelUpDirectiveCard } from "@/components/mastery/level-up-directive-card";
// The interactive goal surface (LifeGoal ladder + active missions) folded in
// from the retired /goals page. Self-fetches /api/goals · zero type coupling.
import { GoalBoard } from "@/components/goals/goal-board";
import { ForecastDuel } from "@/components/stats/forecast-duel";
// Coach Channel · goal drift/prune nudges. Self-hides when empty.
import { CoachEventBanner } from "@/components/mastery/coach-event-banner";
import { MissionBreadcrumb } from "@/components/mastery/mission-breadcrumb";
import { NickSidePane } from "@/components/mastery/nick-side-pane";
import { MasteryList } from "@/components/stats/mastery-list";
// Wave E2: moved from the Brain Self-model fold to Goals, beside the calibration section.
import { CalibrationTile } from "@/components/stats/calibration-tile";
import { PredictionStreaksCard } from "@/components/brain/prediction-streaks-card";
import { GhostNickStrip } from "@/components/ultron/ghost-nick/ghost-nick-strip";

/** While a lazy section's code loads: the state in words (W4), not a pulsing block. */
function SectionFallback() {
  return <StatsStateBlock state="loading" message="Loading this section." />;
}

// Wave 2 · /body weight/health tracker, rehomed as a lazy section.
const BodySection = dynamic(
  () => import("@/components/stats/body-section").then((m) => m.BodySection),
  { ssr: false, loading: () => <SectionFallback /> },
);

// Wave 2 · the active AI learning loop (teach/research · spaced-repetition ·
// decision-linked prompts), rehomed from the bottom of /learn. The static
// Build-Your-Own-X catalog stays at /learn.
const LearningLoop = dynamic(
  () => import("@/components/actions/mode-learn").then((m) => m.KommandoLearn),
  { ssr: false, loading: () => <SectionFallback /> },
);


const CalibrationSection = dynamic(
  () => import("@/components/stats/calibration-section").then((m) => m.CalibrationSection),
  { ssr: false, loading: () => <SectionFallback /> },
);

/** The static prerender shell until the client subtree hydrates: the state in words (W4). */
function StatsBodyFallback() {
  return <StatsStateBlock state="loading" message="Reading your stats." />;
}

function StatsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const pathname = usePathname();

  // An unknown ?tab (a retired deep link such as /business?tab=money, which
  // Next forwards as /stats?tab=money, or a typo) falls back to the first tab
  // instead of rendering an empty body (#2069 review). Pure helper so the
  // retired-routes gate can pin it.
  const activeTab = resolveStatsTab(searchParams.get("tab"));

  // A retired key (?tab=learning, ?tab=calibration) lands on the tab that holds its section;
  // bring that section into view, since it is no longer at the top of a tab of its own. The
  // sections carry scroll-mt-16 so they clear the sticky tab bar (fix round 1).
  const requestedTab = searchParams.get("tab");
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!requestedTab || !Object.hasOwn(STATS_TAB_ALIASES, requestedTab)) return;
    const scroll = () =>
      document.getElementById(requestedTab)?.scrollIntoView({ block: "start", behavior: scrollBehavior() });
    const frame = requestAnimationFrame(scroll);
    // Fix round 1: the tab's lazy sections load after that first scroll and push the target down, so
    // scroll once more the first time the panel changes size, then stop; a later resize, or one after
    // 4 s, is no longer the deep link's to act on.
    let observer: ResizeObserver | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const panel = panelRef.current;
    if (panel && typeof ResizeObserver !== "undefined") {
      let initial = true; // a ResizeObserver reports once when observation starts
      observer = new ResizeObserver(() => {
        if (initial) {
          initial = false;
          return;
        }
        scroll();
        observer?.disconnect();
        observer = null;
      });
      observer.observe(panel);
      timer = setTimeout(() => observer?.disconnect(), 4000);
    }
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      if (timer) clearTimeout(timer);
    };
  }, [requestedTab]);

  const handleTabChange = (tabId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tabId);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="space-y-6">
      {/* W4: the one sentence that says where Nour stands, above the tabs. */}
      <StatsVerdict />

      {/* Tab bar · 2026-09-16 Visible Transformation: the glassmorphic pill
          bar (backdrop blur, white/[0.02] glass, a blue→indigo→purple accent
          that carried an anti-slop waiver) is replaced by the house underline
          bar — Geist 13px labels, an accent rule under the selected tab, no glass. */}
      <div
        role="tablist"
        aria-label="Stats sections"
        className="sticky top-0 z-20 -mx-4 flex gap-x-6 overflow-x-auto border-b border-edge-subtle bg-canvas px-4 sm:mx-0 sm:px-0"
      >
        {STATS_TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => handleTabChange(tab.id)}
              className={`-mb-px inline-flex min-h-[48px] shrink-0 items-center border-b-2 px-1 text-[13px] font-medium transition-colors duration-[var(--motion-state)] ${
                isActive ? "border-accent text-fg" : "border-transparent text-fg-tertiary hover:text-fg-secondary"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content wrapper with smooth transitions */}
      <div ref={panelRef} className="mt-4">
        {activeTab === "mastery" && (
          <div className="space-y-6 animate-in fade-in duration-300">
            {/* Today's move first, then the one Mastery row list (wave E2: three same-height cards
                merged), then the character sheet. */}
            <LevelUpDirectiveCard />
            <MasteryList />
            <CharacterSheet />
          </div>
        )}

        {activeTab === "goals" && (
          <div className="space-y-6 animate-in fade-in duration-300">
            {/* Coach nudges and the mission breadcrumb render nothing when empty, so no wrapper (an
                empty wrapper still took a gap). */}
            <CoachEventBanner surface="goals" />
            <MissionBreadcrumb />

            {/* Where you're going: the interactive GoalBoard. */}
            <section id="goals" className="space-y-3">
              <MasterySectionLabel label="Goals · what you're climbing toward" />
              <GoalBoard />
            </section>
            {/* Calibration (W4: folded under Goals). Wave E2: the Brain calibration and prediction
                streak cards lead it; the tile replaces the section's own duplicate accuracy card. */}
            <section id="calibration" className="scroll-mt-16 space-y-4">
              <MasterySectionLabel label="Calibration · outcome benchmarking" />
              <CalibrationTile />
              <PredictionStreaksCard />
              <CalibrationSection />
            </section>
            {/* Forecast duel, you vs Nick (#1393's missing consumer), then Ghost Nick's own open
                predictions (wave E2, from the Brain fold). */}
            <section id="forecast-duel" className="space-y-4">
              <MasterySectionLabel label="Forecast duel · odds on yourself" />
              <ForecastDuel />
              <GhostNickStrip />
            </section>
          </div>
        )}

        {activeTab === "body" && (
          <div className="space-y-6 animate-in fade-in duration-300">
            {/* ③ BODY · weight + daily health log */}
            <section id="body" className="space-y-3">
              <MasterySectionLabel label="Body · health = performance" />
              <BodySection />
            </section>
            {/* ④ LEARNING · the active AI learning loop (W4: folded under Body and learning) */}
            <section id="learning" className="scroll-mt-16 space-y-3">
              <MasterySectionLabel label="Learning · the active loop" />
              <LearningLoop />
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

export default function StatsPage() {
  return (
    <>
      <StandardPage eyebrow="Who you are · where you're going" title="Stats">
        <Suspense fallback={<StatsBodyFallback />}>
          <StatsContent />
        </Suspense>
      </StandardPage>

      {/* Per-page Nick · grounded in goals (personal), presets about leveling
       *  + goal progress — no business / KPI framing on this surface. */}
      <Suspense fallback={null}>
        <NickSidePane
          page="goals"
          coachSurface="goals"
          presets={[
            "Which stat am I closest to leveling up?",
            "What's the fastest way to level up today?",
            "Which goal needs my attention most?",
            "Where am I falling behind this week?",
            "How calibrated are my prediction outcomes?",
            "What is my task ROI estimation error?",
          ]}
        />
      </Suspense>
    </>
  );
}
