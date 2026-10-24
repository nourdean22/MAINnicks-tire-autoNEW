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
 * telemetry, suggestion telemetry. Calibration, prediction streaks, Ghost Nick and preferences sit in
 * Self-model until their own pages take them (Stats Goals and Settings, a later wave).
 *
 * The ticker and Home link here as #contradictions (the panel sits under the id).
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";
import { SkillLibraryPanel } from "@/components/settings/skill-library-panel";
import { MemoryOfDayCard } from "@/components/brain/memory-of-day-card";
import { QualitativeIdentityPanel } from "@/components/brain/qualitative-identity-panel";
import { CoachEventBanner } from "@/components/mastery/coach-event-banner";
import { MissionBreadcrumb } from "@/components/mastery/mission-breadcrumb";
import { BeliefsPanel } from "@/components/brain/beliefs-panel";
import { ContradictionResolutionPanel } from "@/components/brain/contradiction-resolution-panel";
import { GhostNickStrip } from "@/components/ultron/ghost-nick/ghost-nick-strip";
import { DecisionReplayCard } from "@/components/ultron/decision-replay-card";
import { PreferencesCard } from "@/components/ultron/preferences-card";
import { NudgePanel } from "@/components/brain/nudge-panel";
import { BrainMaturityHeader } from "@/components/brain/brain-maturity-header";
import { PredictionStreaksCard } from "@/components/brain/prediction-streaks-card";
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
import { BrainFold, ReadingUnavailable } from "@/components/brain/brain-fold";
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
      <BeliefsPanel />
      <IdentityDeltaLine />
      <RecallInboxPanel />
      <NickSuggestions />
      {/* The former Wisdom tab (2026-10-19, wave 2V). It owns its own ?focus= and ?evolution=1
          handling, so /brain?tab=memory&focus=<key> still scrolls to a card. */}
      <WisdomSection />

      <div>
        <BrainFold title="Signals">
          <InsightRibbon />
          <BrainInsightsPanel />
          <PatternCard />
          <ActiveAlertsCard />
        </BrainFold>
        <BrainFold title="Self-model">
          <MemoryOfDayCard />
          <SkillLibraryRow />
          <QualitativeIdentityPanel />
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
          <CalibrationTile />
          <PredictionStreaksCard />
          <GhostNickStrip />
          <PreferencesCard />
        </BrainFold>
        <BrainFold title="Context">
          <NudgePanel />
          <PinnedContextPanel />
          <RecallPreviewPanel />
        </BrainFold>
      </div>
    </div>
  );
}

/**
 * The skill library lives in components/settings (another lane's files) and its failed branch carries
 * no marker the Self-model fold can count. The same query (same key and options, so React Query serves
 * one cache entry and no second fetch) adds the marker here.
 */
function SkillLibraryRow() {
  const skillsQuery = trpc.operator.skills.useQuery(undefined, { refetchOnWindowFocus: false });
  return (
    <div>
      {skillsQuery.isError && !skillsQuery.data && <ReadingUnavailable label="Skill library" />}
      {/* Paused before any data (offline at start): no error, no list, so say offline. */}
      {readState(skillsQuery) === "offline" && <ReadStateNote state="offline" label="Skill library" />}
      <SkillLibraryPanel />
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
  if (isError) return <ReadingUnavailable label="Identity delta" />;
  // A paused read (offline) has no error either: not "nothing shifted" (truth sweep 2026-10-23).
  if (readState(deltaQ) === "offline") return <ReadStateNote state="offline" label="Identity delta" />;
  if (!data?.delta) return null;
  return (
    <div className="flex items-start gap-3 border-l-2 border-edge py-1 pl-4 text-[13px]">
      <span className="mt-0.5 shrink-0 font-mono text-fg-tertiary">yesterday to today</span>
      <p className="flex-1 leading-snug text-fg-secondary">{data.delta.slice(0, 280)}</p>
    </div>
  );
}

/**
 * Wave V #2 · Calibration tile.
 *
 * `summarizeCalibration` returns hitRate + meanBrier + verdict + avgClaimVsRealityGap. Brier scores
 * are populated on every resolved Prediction by the outcome-tracker cron.
 *
 * Silent when resolved === 0: a genuinely quiet 30 days shows nothing, per the page's
 * silent-when-empty rule. A FAILED read is not that: it renders explicitly (2026-09-02). The helper
 * used to swallow Prisma errors into `resolved: 0`, so an unreachable database and a quiet month were
 * the same pixel. The window also filtered on `createdAt`, which excluded every prediction with a
 * horizon of 30 days or more; it now keys on resolution time.
 */
function CalibrationTile() {
  const calibrationQ = trpc.brain.calibrationSummary.useQuery(
    { days: 30 },
    { refetchOnWindowFocus: false, staleTime: 5 * 60 * 1000 },
  );
  const { data, isError } = calibrationQ;
  if (isError) return <ReadingUnavailable label="Calibration" />;
  if (!data && readState(calibrationQ) === "offline") return <ReadStateNote state="offline" label="Calibration" />;
  if (!data || data.resolved === 0) return null;
  // Verdict map matches the helper's enum: "well-calibrated" | "drift" | "unknown"; drift is the
  // warning signal (>= 15% off).
  const verdictTint =
    data.verdict === "well-calibrated"
      ? "text-emerald-300"
      : data.verdict === "drift"
        ? "text-amber-300"
        : "text-fg-tertiary";
  return (
    <section aria-label="calibration" className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        {/* "resolved 30d", not "30d": the population is predictions that RESOLVED in the last 30
            days, whenever they were made. */}
        <h3 className="text-[15px] font-medium text-fg">Calibration · resolved 30d</h3>
        <p className={cn("text-[13px] font-mono tabular-nums", verdictTint)}>{data.verdict.replace(/-/g, " ")}</p>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5 font-mono text-[13px]">
        <span>
          <span className="mr-1 text-fg-tertiary">mean Brier</span>
          <span className="tabular-nums text-fg">{data.meanBrier != null ? data.meanBrier.toFixed(3) : "none"}</span>
          <span className="ml-1 text-fg-tertiary">(coin = 0.25)</span>
        </span>
        {data.hitRate !== null && (
          <span>
            <span className="mr-1 text-fg-tertiary">hit rate</span>
            <span className="tabular-nums text-fg">{Math.round(data.hitRate * 100)}%</span>
            <span className="ml-1 text-fg-tertiary">
              · {data.confirmed}/{data.resolved}
            </span>
          </span>
        )}
        {data.avgClaimVsRealityGap !== null && (
          <span>
            <span className="mr-1 text-fg-tertiary">claim-vs-reality gap</span>
            <span className="tabular-nums text-fg">{Math.round(data.avgClaimVsRealityGap * 100)}%</span>
          </span>
        )}
      </div>
    </section>
  );
}
