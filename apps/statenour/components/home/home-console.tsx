"use client";

/**
 * HomeConsole — the four-question decision page (2026-07-25 Home
 * consolidation, audit P1, operator-approved scope):
 *
 *   1. Is anything broken?        → HomeHealthChip (measured, /system link)
 *   2. What requires my decision? → ContradictionSlot + FollowUpsList (the latter was an
 *                                    never-rendered orphan; now mounted)
 *   3. What should I do now?      → ExecutiveActionMatrix (honest copy)
 *   4. What changed since last visit? → SinceLastVisitCard
 *
 * Plus the single Nick strip (CognitivePartner — morning brief is a tap
 * now, never an auto-fired spend) under the identity header.
 *
 * DELIBERATELY GONE from Home (audit P1 "cockpit, not decision page"):
 *   · HomeBrainGraph — lives at /brain (one tap via the drill-down row)
 *   · HomeEnginesDeck — lives at /system
 *   · dead imports (CoachEventBanner, HomeJournalHub) — never rendered
 * Component files are untouched; only Home stopped mounting them.
 */

import Link from "next/link";
import { HomeIdentityHeader } from "./home-identity-header";
import { CognitivePartner } from "./cognitive-partner";
import { FollowUpsList } from "./follow-ups-list";
import { ContradictionSlot } from "./contradiction-slot";
import { ProposedCommitments } from "./proposed-commitments";
import { ExecutiveActionMatrix } from "./executive-action-matrix";
import { HomeHealthChip } from "./home-health-chip";
import { SinceLastVisitCard } from "@/components/ultron/since-last-visit-card";

export function HomeConsole() {
  return (
    <div className="mx-auto max-w-[1200px] px-3 sm:px-6 pb-8 flex flex-col gap-6">
      {/* Identity + the single Nick strip */}
      <section aria-label="Operator Identity" className="space-y-4">
        <HomeIdentityHeader />
        <CognitivePartner />
      </section>

      {/* Q1 · Is anything broken? */}
      <section aria-label="System health" className="flex items-center justify-between gap-3 flex-wrap">
        <HomeHealthChip />
        {/* Drill-downs for what used to live on Home */}
        <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.12em]">
          <Link
            href="/brain"
            className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-1.5 text-zinc-400 transition hover:text-zinc-200 hover:bg-white/[0.05] min-h-[36px] inline-flex items-center"
          >
            Brain graph →
          </Link>
          <Link
            href="/system"
            className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-1.5 text-zinc-400 transition hover:text-zinc-200 hover:bg-white/[0.05] min-h-[36px] inline-flex items-center"
          >
            Engines →
          </Link>
        </div>
      </section>

      {/* Q2 · What requires my decision? */}
      <section aria-label="Decisions awaiting" className="min-w-0 space-y-4">
        {/* 2026-08-16 · the one knowledge-layer signal that earns Home. Renders
            NOTHING when there is no unresolved contradiction — see the
            component header for why nothing else from /brain qualifies. */}
        <ContradictionSlot />
        <FollowUpsList />
        {/* WP-16 · journal nextActions arrive here as proposals awaiting verdict */}
        <ProposedCommitments />
      </section>

      {/* Q3 · What should I do now? */}
      <section aria-label="Do now" className="min-w-0">
        <ExecutiveActionMatrix />
      </section>

      {/* Q4 · What changed since last visit? */}
      <section aria-label="Since last visit" className="min-w-0">
        <SinceLastVisitCard limit={20} />
      </section>
    </div>
  );
}
