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
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-[var(--font-display)] font-bold lowercase tracking-wider text-[var(--text-primary)]">
            brain
          </h1>
          <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
            everything the system knows about you · learns every day
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
            className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border border-[var(--border-default)] text-[var(--text-tertiary)] hover:border-[var(--gold)]/40 hover:text-[var(--gold)] transition-colors"
            title="memory rollup · categories · continuity"
          >
            health →
          </a>
        </div>
      </div>

      <BrainMaturityHeader refreshKey={refreshKey} />

      {/* v10.0.529.92 · Wave 36 · proactive Nick chips on /brain. The
          same NickSuggestions strip mounted in chat now appears here ·
          tapping a chip navigates to /chat?q=...&suggKind=X&suggId=Y
          where the chat page hydrates input + transport anchors on
          mount. Closes the "I'm reviewing my brain · what action
          should I take" loop without leaving the page first. */}
      <NickSuggestions />

      {/* v10.0.218 · cross-system narrative ribbon · sits ABOVE actionable
          panels because it answers "what's the SHAPE of this week" before
          the operator dives into "what should I do right now". Auto-hides
          on weeks with no surfaceable patterns — clean weeks get no ribbon. */}
      <InsightRibbon />

      {/* v10.0.407 · brain insights panel · 3-up dashboard for the
          new feedback layers (violations · evolution · improve-agent).
          Auto-hides when no signal in any bucket. */}
      <BrainInsightsPanel />

      {/* v10.0.529.79 · Wave 23 · #2 · pattern clusters · "the system
          noticed" surface. Auto-hides until 3+ insights cluster on
          the same 8-axis identity dimension. */}
      <PatternCard />

      <ActiveAlertsCard />

      <PredictionStreaksCard />

      <NudgePanel />

      <PinnedContextPanel />

      <GhostNickStrip />

      <ContradictionResolutionPanel focusKey={focusContradictionKey} />

      {/* v10.0.529.48 · relocated cards · grouped here as the new
          "self-model + reflection" cluster on /brain. Each is silent
          on empty so they earn slots only when there's signal. */}
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

      <ToolTelemetryPanel />

      <SuggestionTelemetryPanel />
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
