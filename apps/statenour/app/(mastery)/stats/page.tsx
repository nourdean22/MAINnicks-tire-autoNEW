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
 * /body → /stats#body · /life → /stats.
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
 * Suspense boundary: <MissionBreadcrumb> reads useMissionMode() →
 * useSearchParams(), which Next bails to client-side render at prerender
 * time unless wrapped. NickSidePane gets its own so any search-param child
 * there is covered too.
 */

import { Suspense } from "react";
import dynamic from "next/dynamic";
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
// Coach Channel · goal drift/prune nudges. Self-hides when empty.
import { CoachEventBanner } from "@/components/mastery/coach-event-banner";
import { MissionBreadcrumb } from "@/components/mastery/mission-breadcrumb";
import { NickSidePane } from "@/components/mastery/nick-side-pane";

/** Below-the-fold section shimmer · holds layout while the lazy chunk loads. */
function SectionFallback() {
  return (
    <div className="space-y-3" aria-hidden>
      <div className="h-24 rounded-lg border border-white/10 bg-white/[0.02] animate-pulse" />
      <div className="h-40 rounded-lg border border-white/[0.07] bg-white/[0.02] animate-pulse" />
    </div>
  );
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

const IdentityArcCard = dynamic(
  () => import("@/components/mastery/identity-arc-card").then((m) => m.IdentityArcCard),
  { ssr: false, loading: () => <div className="h-[200px] rounded-lg border border-white/10 bg-white/[0.02] animate-pulse" /> },
);

/** Light shimmer matching the character-sheet hero + stat-grid shape, so the
 *  static prerender shell holds the layout until the client subtree hydrates. */
function StatsBodyFallback() {
  return (
    <div className="mt-6 space-y-3" aria-hidden>
      <div className="h-16 rounded-lg border border-white/10 bg-white/[0.02] animate-pulse" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-10 rounded-md border border-white/[0.07] bg-white/[0.02] animate-pulse"
          />
        ))}
      </div>
    </div>
  );
}

export default function StatsPage() {
  return (
    <>
      <StandardPage eyebrow="Who you are · where you're going" title="Stats">
        <Suspense fallback={<StatsBodyFallback />}>
          {/* ⓪ TODAY'S MOVE & IDENTITY ARC · responsive 2-column layout */}
          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <LevelUpDirectiveCard />
            <IdentityArcCard />
          </div>

          {/* ① WHO YOU ARE · the character sheet (the stats — the hero). */}
          <CharacterSheet />

          {/* Coach Channel · goal nudges + mission-mode breadcrumb (compact,
           *  both self-hide when there's nothing to surface). */}
          <div className="mt-4 space-y-2">
            <CoachEventBanner surface="goals" />
            <MissionBreadcrumb />
          </div>

          {/* ② WHERE YOU'RE GOING · the goals surface (interactive GoalBoard). */}
          <section id="goals" className="mt-8 space-y-3 scroll-mt-24">
            <MasterySectionLabel label="Goals · what you're climbing toward" />
            <GoalBoard />
          </section>

          {/* ③ BODY · weight + daily health log (was /body) · lazy-mounted ·
           *  id="body" so /body → /stats#body lands here. */}
          <section id="body" className="mt-8 space-y-3 scroll-mt-24">
            <MasterySectionLabel label="Body · health = performance" />
            <BodySection />
          </section>

          {/* ④ LEARNING · the active AI learning loop (was the bottom of
           *  /learn) · lazy-mounted · id="learning" anchor. */}
          <section id="learning" className="mt-8 space-y-3 scroll-mt-24">
            <MasterySectionLabel label="Learning · the active loop" />
            <LearningLoop />
          </section>
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
          ]}
        />
      </Suspense>
    </>
  );
}
