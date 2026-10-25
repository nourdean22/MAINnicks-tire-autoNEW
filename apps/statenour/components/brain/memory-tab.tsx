"use client";

/**
 * MemoryTab: the Memory section of /brain. Its one decision is "correct what the brain believes".
 *
 * Wave D (2026-10-24, bdnick pro rebuild; census 2026-10-23 section 3H). The tab used to stack 28
 * components in six labelled sections, so the contradictions sat under self-model and telemetry.
 * Now nine visible blocks, in this order: the coach banner and mission breadcrumb (both hide when
 * empty), the maturity line, Contradictions and Beliefs (the dominant pair), the identity delta, the
 * recall inbox, Nick's suggestions, and Wisdom. Then three CLOSED folds (BrainFold): Signals,
 * Self-model and Context. Each fold keeps its children mounted, counts the rows that rendered and
 * says "(n unreadable)" when a child's read failed.
 *
 * NickSuggestions stays visible: its chips carry suggKind/suggId anchors into /chat, and the
 * NickSidePane presets are fixed strings, so folding them in would drop the anchors.
 * Moved to the Health tab (components/brain/health-tab.tsx): learning velocity, persona drift, tool
 * telemetry, suggestion telemetry. Wave E2 (2026-10-24): calibration, prediction streaks and Ghost Nick
 * moved to Stats Goals (components/stats/calibration-tile.tsx holds the calibration line) and preferences to Settings,
 * How Nick works. The skill library carries its own read markers, so the fold counts it directly.
 *
 * The ticker and Home link here as #contradictions (the panel sits under the id).
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { SkillLibraryPanel } from "@/components/settings/skill-library-panel";
import { MemoryOfDayCard } from "@/components/brain/memory-of-day-card";
import { QualitativeIdentityPanel } from "@/components/brain/qualitative-identity-panel";
import { CoachEventBanner } from "@/components/mastery/coach-event-banner";
import { MissionBreadcrumb } from "@/components/mastery/mission-breadcrumb";
import { BeliefsPanel } from "@/components/brain/beliefs-panel";
import { ContradictionResolutionPanel } from "@/components/brain/contradiction-resolution-panel";
import { DecisionReplayCard } from "@/components/ultron/decision-replay-card";
import { NudgePanel } from "@/components/brain/nudge-panel";
import { BrainMaturityHeader } from "@/components/brain/brain-maturity-header";
import { ActiveAlertsCard } from "@/components/brain/active-alerts-card";
import { PinnedContextPanel } from "@/components/brain/pinned-context-panel";
import { InsightRibbon } from "@/components/brain/insight-ribbon";
import { BrainInsightsPanel } from "@/components/brain/brain-insights-panel";
import { ReadStateNote } from "@/components/ui/read-state-note";
import { readState } from "@/lib/query-state";
import { SelfCritiqueCard } from "@/components/brain/self-critique-card";
import { RecallInboxPanel } from "@/components/brain/recall-inbox-panel";
import { RecallPreviewPanel } from "@/components/brain/recall-preview-panel";
import { PatternCard } from "@/components/brain/pattern-card";
import { AntiPatternsPanel } from "@/components/brain/anti-patterns-panel";
import { useIdleWarmup } from "@/hooks/use-idle-warmup";
import { onDataChanged } from "@/lib/events/data-change";
import { NickSuggestions } from "@/components/chat/nick-suggestions";
import { WisdomSection } from "@/components/brain/wisdom-section";
import { BrainFold, ReadingUnavailable, StaleNote } from "@/components/brain/brain-fold";
import { MemoryVerdict } from "@/components/brain/memory-verdict";

export function MemoryTab() {
  const [refreshKey, setRefreshKey] = useState(0);

  // Idle-warm the chat lambda: if Nour navigates /brain to /chat, the prompt cache is already hot.
  useIdleWarmup();

  // The event bus fires on every chat-tool brain write (pinMemory, buildArchitectureMemory,
  // learnCodingPreference); it is the only refresh path (Wave V dropped the redundant 60s poll).
  useEffect(() => {
    return onDataChanged(["brain"], () => setRefreshKey((k) => k + 1));
  }, []);

  return (
    <div className="space-y-6">
      {/* Round 5: the tab leads with its one decision, the System control tower's shape. */}
      <MemoryVerdict />
      <div className="space-y-2">
        <CoachEventBanner surface="brain" />
        <MissionBreadcrumb />
      </div>

      <BrainMaturityHeader refreshKey={refreshKey} />

      <div id="contradictions" className="scroll-mt-24">
        <ContradictionResolutionPanel />
      </div>
      <div id="beliefs" className="scroll-mt-24">
        <BeliefsPanel />
      </div>
      <IdentityDeltaLine />
      <RecallInboxPanel />
      <NickSuggestions />
      {/* The former Wisdom tab (2026-10-19, wave 2V). It owns its own ?focus= and ?evolution=1
          handling, so /brain?tab=memory&focus=<key> still scrolls to a card. */}
      <div id="wisdom" className="scroll-mt-24">
        <WisdomSection />
      </div>

      <div>
        <BrainFold title="Signals">
          <InsightRibbon />
          <BrainInsightsPanel />
          <PatternCard />
          <ActiveAlertsCard />
        </BrainFold>
        <BrainFold title="Self-model">
          <MemoryOfDayCard />
          <SkillLibraryPanel />
          <div id="qualitative" className="scroll-mt-24">
            <QualitativeIdentityPanel />
          </div>
          {/* UI v3 W5a: IdentityPanel has one home, Settings > Identity and Behavior. */}
          <Link
            href="/settings"
            className="flex min-h-[44px] items-center justify-between gap-3 border-y border-edge text-sm text-fg-secondary hover:text-fg"
          >
            <span>Identity axes and pins are edited in Settings, Identity and Behavior</span>
            <span className="shrink-0 font-mono text-[13px] text-fg-tertiary">Open</span>
          </Link>
          <SelfCritiqueCard />
          <DecisionReplayCard />
          <AntiPatternsPanel />
        </BrainFold>
        <BrainFold title="Context">
          <div id="nudges" className="scroll-mt-24">
            <NudgePanel />
          </div>
          <PinnedContextPanel />
          <RecallPreviewPanel />
        </BrainFold>
      </div>
    </div>
  );
}

/**
 * Wave V #6: identity-delta narrative line. IdentitySnapshot.deltaFromLast is written by the daily
 * identity-refresh cron (config/crons/identity-snapshot.ts) as a sentence about what shifted in the
 * 8-axis self-model. Silent when the field is empty (a first snapshot), so the row never says
 * "no delta yet".
 */
function IdentityDeltaLine() {
  const deltaQ = trpc.brain.identityDelta.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });
  const { data, isError } = deltaQ;
  // A failed read is NOT "nothing shifted today": say which one it is.
  if (isError && !data) return <ReadingUnavailable label="Identity delta" />;
  // A paused read (offline) has no error either: not "nothing shifted" (truth sweep 2026-10-23).
  if (readState(deltaQ) === "offline") return <ReadStateNote state="offline" label="Identity delta" />;
  if (!data?.delta) return <StaleNote q={deltaQ} label="Identity delta" />;
  return (
    <div className="space-y-1">
      <StaleNote q={deltaQ} label="Identity delta" />
      <div className="flex items-start gap-3 border-l-2 border-edge py-1 pl-4 text-[13px]">
        <span className="mt-0.5 shrink-0 font-mono text-fg-tertiary">yesterday to today</span>
        <p className="flex-1 leading-snug text-fg-secondary">{data.delta.slice(0, 280)}</p>
      </div>
    </div>
  );
}
