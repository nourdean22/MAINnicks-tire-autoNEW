"use client";

/**
 * /brain — unified brain dashboard. Apr 19.
 *
 * Central place where every self-model subsystem surfaces:
 *   • Header: brain maturity score + counters
 *   • Skill Library (full panel — promote/graduate/edit)
 *   • Identity snapshot (8-axis + sparklines)
 *   • Qualitative identity (values/fears/style/rhythms/red lines)
 *   • Beliefs (curated positions)
 *   • Contradictions (unresolved + history)
 *   • Ghost Nick predictions (uses same strip as HQ)
 *   • Nudges (cross-system live deltas)
 *
 * Accepts ?resolve=<key> query param — bottom ticker deep-links here
 * when Nour clicks a contradiction chip, scrolling the row into view.
 */

import { useSearchParams } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import { MasterySectionLabel } from "@/components/mastery/mastery-section-label";
import { SkillLibraryPanel } from "@/components/settings/skill-library-panel";
import { IdentityPanel } from "@/components/settings/identity-panel";
import { QualitativeIdentityPanel } from "@/components/brain/qualitative-identity-panel";
import { BeliefsPanel } from "@/components/brain/beliefs-panel";
import { ContradictionResolutionPanel } from "@/components/brain/contradiction-resolution-panel";
import { GhostNickStrip } from "@/components/ultron/ghost-nick/ghost-nick-strip";
// v10.0.529.48 · relocated from /ultron during the aggressive-cut
// redesign. These four are diagnostic / reflection / settings-tier ·
// they live with the other brain panels here. /ultron stays focused
// on today's anchor + work surface.
import { DecisionReplayCard } from "@/components/ultron/decision-replay-card";
import { ContradictionsCard } from "@/components/ultron/contradictions-card";
import { PreferencesCard } from "@/components/ultron/preferences-card";
import { PersonaDriftCard } from "@/components/ultron/persona-drift-card";
import { NudgePanel } from "@/components/brain/nudge-panel";
import { BrainMaturityHeader } from "@/components/brain/brain-maturity-header";
import { PredictionStreaksCard } from "@/components/brain/prediction-streaks-card";
import { ActiveAlertsCard } from "@/components/brain/active-alerts-card";
import { ToolTelemetryPanel } from "@/components/brain/tool-telemetry-panel";
import { PinnedContextPanel } from "@/components/brain/pinned-context-panel";
import { SuggestionTelemetryPanel } from "@/components/brain/suggestion-telemetry-panel";
import { InsightRibbon } from "@/components/brain/insight-ribbon";
import { BrainInsightsPanel } from "@/components/brain/brain-insights-panel";
import { PatternCard } from "@/components/brain/pattern-card";
import { useIdleWarmup } from "@/hooks/use-idle-warmup";
import { onDataChanged } from "@/lib/events/data-change";
import { NickSuggestions } from "@/components/chat/nick-suggestions";

function BrainPageInner() {
  const params = useSearchParams();
  const focusContradictionKey = params.get("resolve");
  const [refreshKey, setRefreshKey] = useState(0);

  // Idle-warm the chat lambda — if Nour navigates /brain → /chat,
  // the prompt cache is already hot.
  useIdleWarmup();

  // Poll maturity header every 60s so counters stay fresh
  useEffect(() => {
    const id = setInterval(() => setRefreshKey((k) => k + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // v10.0.529.89 · Wave 33 · instant refresh when chat tools fire
  // "brain" (pinMemory · buildArchitectureMemory · learnCodingPreference).
  // Pre-Wave-33 the operator could pin via chat and PinnedContextPanel
  // stayed stale up to 60s while polling caught up.
  useEffect(() => {
    return onDataChanged(["brain"], () => setRefreshKey((k) => k + 1));
  }, []);

  return (
    <div className="space-y-6">
      {/* Canonical editorial header · matches /goals + /scoreboard pattern
          per ADR-0015 design tokens. Pre-2026-05-18 PM the header used
          lowercase Barlow Condensed with the page name only · now adds
          the eyebrow supertitle, displays the .page-title scale, and
          right-aligns the deep-dive nav. */}
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)] mb-1">
            Mastery
          </p>
          <h1 className="text-2xl font-medium text-[var(--text-primary)]">
            Brain
          </h1>
          <p className="text-xs text-[var(--text-tertiary)] mt-1.5 max-w-[60ch]">
            Everything the system knows about you · learns every day.
          </p>
        </div>
        {/* v10.0.529.49 · deep-dive nav cut from 8 buttons → 1.
            Sub-routes /brain/search · /critique · /improve · /time-travel
            · /galaxy were merged or killed in the consolidation wave.
            The remaining sub-routes are /brain/health (memory rollup)
            and /brain/wisdom + /brain/link-review (rendered inline below
            as full panels), plus the deep-tabs on /health for categories
            and continuity. */}
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          <a
            href="/brain/health"
            className="text-[10px] font-semibold uppercase tracking-[0.14em] px-3 py-2 min-h-[44px] inline-flex items-center rounded border border-[var(--border-default)] text-[var(--text-tertiary)] hover:border-[var(--gold)]/40 hover:text-[var(--gold)] transition-colors"
            title="memory rollup · categories · continuity"
          >
            health →
          </a>
        </div>
      </header>

      <BrainMaturityHeader refreshKey={refreshKey} />

      {/* v10.0.529.92 · Wave 36 · proactive Nick chips on /brain. The
          same NickSuggestions strip mounted in chat now appears here ·
          tapping a chip navigates to /chat?q=...&suggKind=X&suggId=Y
          where the chat page hydrates input + transport anchors on
          mount. */}
      <NickSuggestions />

      {/* ZONE 1 · SIGNAL · what the brain noticed worth surfacing.
          Each panel silent-when-empty per its own design · the zone
          label only appears when this audit treatment was added
          2026-05-18 PM to give visual rhythm to the 20+ panel wall.
          Pre-treatment they were 20 stacked atoms · post-treatment
          they're 5 named zones with the same atoms inside. */}
      <section className="space-y-3 pt-2">
        <MasterySectionLabel label="Signal" />
        <div className="space-y-6">
          <InsightRibbon />
          <BrainInsightsPanel />
          <PatternCard />
          <ActiveAlertsCard />
        </div>
      </section>

      {/* ZONE 2 · PREDICTIONS · what the brain thinks comes next. */}
      <section className="space-y-3 pt-2">
        <MasterySectionLabel label="Predictions" />
        <div className="space-y-6">
          <PredictionStreaksCard />
          <GhostNickStrip />
        </div>
      </section>

      {/* ZONE 3 · CONTEXT · pinned + nudges. */}
      <section className="space-y-3 pt-2">
        <MasterySectionLabel label="Context" />
        <div className="space-y-6">
          <NudgePanel />
          <PinnedContextPanel />
        </div>
      </section>

      {/* ZONE 4 · SELF-MODEL + REFLECTION · the durable knowledge
          the brain carries about the operator. Largest zone · also
          the most operator-actionable (resolve contradictions, edit
          beliefs, etc). */}
      <section className="space-y-3 pt-2">
        <MasterySectionLabel label="Self-model" />
        <div className="space-y-6">
          <ContradictionResolutionPanel focusKey={focusContradictionKey} />
          <div id="contradictions" className="scroll-mt-24">
            <ContradictionsCard />
          </div>
          <DecisionReplayCard />
          <div id="preferences" className="scroll-mt-24">
            <PreferencesCard />
          </div>
          <div id="persona-drift" className="scroll-mt-24">
            <PersonaDriftCard />
          </div>
          <SkillLibraryPanel />
          <IdentityPanel />
          <QualitativeIdentityPanel />
          <BeliefsPanel />
        </div>
      </section>

      {/* ZONE 5 · TELEMETRY · ops view into how tools + suggestions
          are firing. Useful when debugging brain behavior · low
          priority for daily reflection. */}
      <section className="space-y-3 pt-2">
        <MasterySectionLabel label="Telemetry" />
        <div className="space-y-6">
          <ToolTelemetryPanel />
          <SuggestionTelemetryPanel />
        </div>
      </section>
    </div>
  );
}

export default function BrainPage() {
  return (
    <Suspense fallback={<div className="text-[11px] text-[var(--text-tertiary)] p-6">loading brain…</div>}>
      <BrainPageInner />
    </Suspense>
  );
}
