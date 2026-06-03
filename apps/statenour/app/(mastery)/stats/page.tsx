"use client";

/**
 * /stats · 2026-05-30 · the operator's personal stat board.
 *
 * Consolidates the retired /scoreboard + /goals into ONE personal surface:
 *   ① WHO YOU ARE        · the 33-stat mastery character sheet (leveling)
 *   ② WHERE YOU'RE GOING  · the interactive GoalBoard
 *
 * Per operator (2026-05-30): "business shit belongs on nicks tire admin."
 * Every shop/business element that used to live on /scoreboard — Nick's
 * revenue brief, shop-health KPIs, the anchors/anomalies grid, pricing
 * advisory, compound/track deep-dive, the business meta-scoreboard query
 * itself — was REMOVED from here. That intelligence lives at
 * nickstire.org/admin (the Admin nav entry). This page is about Nour, not
 * the shop: who he is and what he's climbing toward.
 *
 * /scoreboard + /goals now 308-redirect to /stats.
 *
 * No top-level query, skeleton, or snapshot: every child self-fetches and
 * self-hides on its own loading/error, so the page stays light.
 *
 * Suspense boundary: <MissionBreadcrumb> reads useMissionMode() →
 * useSearchParams(), which Next bails to client-side render at prerender
 * time unless wrapped. v1 had a loading-skeleton gate that incidentally
 * deferred it; the personal-only strip renders eagerly, so the boundary is
 * now explicit (NickSidePane gets its own so any search-param child there
 * is covered too).
 */

import { Suspense } from "react";
import { StandardPage } from "@/components/layout/standard-page";
import { MasterySectionLabel } from "@/components/mastery/mastery-section-label";
// 2026-05-30 · the mastery leveling engine's face · every stat as an RPG
// level card + an overall-power hero. Self-hides on error · honest Day-1 zero.
import { CharacterSheet } from "@/components/mastery/character-sheet";
// The interactive goal surface (LifeGoal ladder + active missions) folded in
// from the retired /goals page. Self-fetches /api/goals · zero type coupling.
import { GoalBoard } from "@/components/goals/goal-board";
// Coach Channel · goal drift/prune nudges. Self-hides when empty.
import { CoachEventBanner } from "@/components/mastery/coach-event-banner";
import { MissionBreadcrumb } from "@/components/mastery/mission-breadcrumb";
import { NickSidePane } from "@/components/mastery/nick-side-pane";

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
          {/* ① WHO YOU ARE · the character sheet (the stats — the hero). */}
          <div className="mt-6">
            <CharacterSheet />
          </div>

          {/* Coach Channel · goal nudges + mission-mode breadcrumb (compact,
           *  both self-hide when there's nothing to surface). */}
          <div className="mt-4 space-y-2">
            <CoachEventBanner surface="goals" />
            <MissionBreadcrumb />
          </div>

          {/* ② WHERE YOU'RE GOING · the goals surface (interactive GoalBoard). */}
          <section className="mt-8 space-y-3">
            <MasterySectionLabel label="Goals · what you're climbing toward" />
            <GoalBoard />
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
