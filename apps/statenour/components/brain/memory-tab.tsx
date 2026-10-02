"use client";

/**
 * MemoryTab · the Memory section of the merged /brain surface (Wave 2) ·
 * the former /brain hub dashboard.
 *
 * Moved verbatim from the former app/(mastery)/brain/page.tsx — the only
 * changes are: the outer <StandardPage> wrapper became a fragment (the
 * page-level chrome now lives on /brain), the former StandardPage
 * `description` + `actions` (the `health →` link) moved into an inline
 * header row at the top, the former rhythm="loose" section spacing is
 * preserved via a `space-y-5` wrapper, and the Suspense wrapper +
 * page-level NickSidePane moved up to /brain's page shell. The four
 * Wave-V inline components (IdentityDeltaLine, LearningVelocityScoreboard,
 * ScoreboardCell, CalibrationTile) moved here with the body. Data
 * fetching, the ?resolve deep-link, the event-bus refresh, and the
 * 5-zone render are unchanged.
 *
 * Central place where every self-model subsystem surfaces:
 *   • Header: brain maturity score + counters
 *   • Skill Library (full panel — promote/graduate/edit)
 *   • Identity snapshot (8-axis + sparklines) + qualitative identity
 *   • Beliefs · Contradictions · Ghost Nick predictions · Nudges
 *
 * Accepts ?resolve=<key> query param — the bottom ticker deep-links here
 * when Nour clicks a contradiction chip, scrolling the row into view.
 */

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { MasterySectionLabel } from "@/components/mastery/mastery-section-label";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";
import { SkillLibraryPanel } from "@/components/settings/skill-library-panel";
import { IdentityPanel } from "@/components/settings/identity-panel";
import { QualitativeIdentityPanel } from "@/components/brain/qualitative-identity-panel";
import { CoachEventBanner } from "@/components/mastery/coach-event-banner";
import { MissionBreadcrumb } from "@/components/mastery/mission-breadcrumb";
import { BeliefsPanel } from "@/components/brain/beliefs-panel";
import { ContradictionResolutionPanel } from "@/components/brain/contradiction-resolution-panel";
import { GhostNickStrip } from "@/components/ultron/ghost-nick/ghost-nick-strip";
// v10.0.529.48 · relocated from /ultron during the aggressive-cut
// redesign. These four are diagnostic / reflection / settings-tier ·
// they live with the other brain panels here. /ultron stays focused
// on today's anchor + work surface.
import { DecisionReplayCard } from "@/components/ultron/decision-replay-card";
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
import { SelfCritiqueCard } from "@/components/brain/self-critique-card";
import { RecallInboxPanel } from "@/components/brain/recall-inbox-panel";
import { RecallPreviewPanel } from "@/components/brain/recall-preview-panel";
import { PatternCard } from "@/components/brain/pattern-card";
import { AntiPatternsPanel } from "@/components/brain/anti-patterns-panel";
import { useIdleWarmup } from "@/hooks/use-idle-warmup";
import { onDataChanged } from "@/lib/events/data-change";
import { NickSuggestions } from "@/components/chat/nick-suggestions";

export function MemoryTab() {
  const params = useSearchParams();
  const focusContradictionKey = params.get("resolve");
  const [refreshKey, setRefreshKey] = useState(0);

  // Idle-warm the chat lambda — if Nour navigates /brain → /chat,
  // the prompt cache is already hot.
  useIdleWarmup();

  // 2026-05-24 · Wave V P2-#9 · pre-fix the 60s polling interval ran
  // on top of the event-bus refresh below · every 60s the maturity
  // header re-rendered even when nothing changed · AnimatedCounter
  // children (per Wave U findings) flickered on each tick · pure
  // background CPU. Event bus already fires on every chat-tool brain
  // write · operator's own mutations re-render via React state · the
  // 60s polling was redundant. Dropped.

  // v10.0.529.89 · Wave 33 · instant refresh when chat tools fire
  // "brain" (pinMemory · buildArchitectureMemory · learnCodingPreference).
  // Pre-Wave-33 the operator could pin via chat and PinnedContextPanel
  // stayed stale up to 60s while polling caught up. Now (post Wave V)
  // this is the ONLY refresh path · no more redundant polling.
  useEffect(() => {
    return onDataChanged(["brain"], () => setRefreshKey((k) => k + 1));
  }, []);

  return (
    <>
      {/* Former StandardPage description + actions · the `health →` link
          deep-dives into the memory rollup (categories · continuity) ·
          /brain/health remains its own sub-route (auto back-links here). */}
      <div className="flex items-start justify-between gap-3 mb-5">
        <p className="text-sm text-[var(--text-secondary)]" style={{ maxWidth: "60ch" }}>
          What is saved, where it came from, and what is inferred · updated every day.
        </p>
        <a
          href="/brain?tab=health"
          className="shrink-0 inline-flex min-h-[44px] items-center gap-1.5 rounded-control border border-edge-default px-4 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg"
          title="memory rollup · categories · continuity"
        >
          health →
        </a>
      </div>

      <div className="space-y-5">
        {/* Mastery Layer Stage A · Coach Channel surface · 2026-05-26.
         *  Surfaces system-noticed brain events (anomalies, identity
         *  shifts, contradictions). Self-hides when zero events. Stage D ·
         *  mission-mode breadcrumb directly under it. */}
        <div className="space-y-2">
          <CoachEventBanner surface="brain" />
          <MissionBreadcrumb />
        </div>

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
            {/* 2026-05-24 · Wave W Phase 4 · unified recall inbox.
                Single panel aggregating pins · link-review candidates ·
                contradictions · active alerts. Pre-Wave-W the operator
                checked these on 3 separate sub-pages every morning ·
                now one panel · silent-when-empty across all 4 sources
                so a clean morning shows nothing. */}
            <RecallInboxPanel />
            <InsightRibbon />
            <BrainInsightsPanel />
            <PatternCard />
            <ActiveAlertsCard />
            {/* 2026-05-24 · Wave X.f · activation · the self-critique
                cron has written `reply_to_improve` rows nightly but
                nothing on /brain rendered them · loop was dark. Card
                silent-hides on clean weeks. */}
            <SelfCritiqueCard />
          </div>
        </section>

        {/* ZONE 2 · PREDICTIONS · what the brain thinks comes next. */}
        <section className="space-y-3 pt-2">
          <MasterySectionLabel label="Predictions" />
          <div className="space-y-6">
            {/* 2026-05-24 · Wave V feature-mining #2 · calibration tile.
                The summarizeCalibration helper + Prediction.brierScore
                column have been populated by outcome-tracker for weeks ·
                this surfaces the math. Renders next to PredictionStreaksCard
                (hit-rate) · together they answer "do predictions land?"
                (hit-rate) + "are they well-calibrated?" (Brier). Silent
                when resolved === 0. */}
            <CalibrationTile />
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
            <RecallPreviewPanel />
          </div>
        </section>

        {/* ZONE 4 · SELF-MODEL + REFLECTION · the durable knowledge
            the brain carries about the operator. Largest zone · also
            the most operator-actionable (resolve contradictions, edit
            beliefs, etc). */}
        <section className="space-y-3 pt-2">
          <MasterySectionLabel label="Self-model" />
          <div className="space-y-6">
            {/* 2026-05-24 · Wave V feature-mining · learning-velocity
                scoreboard + identity-delta narrative. Both render at the
                TOP of the Self-Model zone because they're the "right now ·
                how is the brain doing" summary that frames the deeper
                panels below (contradictions · beliefs · skills). Both
                reuse paid-for helpers · zero new schema. */}
            <LearningVelocityScoreboard />
            <IdentityDeltaLine />
            <div id="contradictions" className="scroll-mt-24">
              <ContradictionResolutionPanel focusKey={focusContradictionKey} />
            </div>
            <DecisionReplayCard />
            <AntiPatternsPanel />
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
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Wave V · feature-mining wire-ups · 2026-05-24
// ═══════════════════════════════════════════════════════════════════════
//
// Three inline components surfacing paid-for helpers that had zero UI
// consumer prior to Wave V. All silent-by-default per kaizen · render
// nothing when their underlying signal is empty.

/**
 * Wave V #6 · Identity-delta narrative line.
 *
 * IdentitySnapshot.deltaFromLast is populated by the daily 04:30
 * identity-refresh cron (see config/crons/identity-snapshot.ts) ·
 * stores a human-readable sentence describing what shifted in the
 * 8-axis self-model. Pre-Wave-V no UI surfaced it.
 *
 * Reads via the existing `trpc.operator.identity` procedure · zero
 * new server work. Silent when the field is empty (e.g. first
 * snapshot of a new install) so the row never shows "no delta yet"
 * noise.
 */
function IdentityDeltaLine() {
  const { data, isError } = trpc.brain.identityDelta.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });
  // A failed read is NOT "nothing shifted today" — say which one it is.
  if (isError) return <ReadingUnavailable label="Identity delta" />;
  if (!data?.delta) return null;
  return (
    <div className="flex items-start gap-2.5 rounded-control border border-violet-500/20 bg-violet-500/[0.04] px-3 py-2 text-[11px]">
      <span className="font-mono text-[11px] text-violet-300/70 shrink-0 mt-0.5">
        yesterday → today
      </span>
      <p className="text-[var(--text-secondary)] leading-snug flex-1">
        {data.delta.slice(0, 280)}
      </p>
    </div>
  );
}

/**
 * A reading that could not be taken. Distinct from a reading of zero, and
 * distinct from a panel that hides itself because there is genuinely
 * nothing to show. Copy matches components/brain/judgment-quality-panel.tsx
 * so the three states read the same everywhere on /brain.
 */
function ReadingUnavailable({ label }: { label: string }) {
  return (
    <div className="rounded-control border border-red-500/15 bg-red-500/5 px-3 py-2">
      <p className="text-[11px] text-red-400/90">
        {label} couldn&apos;t load — state unknown, not empty.
      </p>
    </div>
  );
}

/**
 * Wave V #5 · Learning-velocity scoreboard.
 *
 * `measureLearningVelocity()` returns a digest exposed via
 * `trpc.journal.learningVelocity` (added in Wave S for the journal ticker).
 *
 * 2026-09-02 · metrics-honesty pass. Every number on this card used to
 * misstate its own window:
 *
 *   · the headline read "brain +N% vs 30d ago" from a composite with no
 *     30-day term in it — three of its five inputs were all-time levels.
 *     A brain that learned nothing for a month scored about +28%. The
 *     composite is deleted (see lib/brain/learning-velocity.ts); the
 *     headline is now a real 30d-vs-prior-30d change in memories created,
 *     and it says "memories", because that is what it measures.
 *   · the four cells below it mixed a 7d count, two 30d counts, and one
 *     LIFETIME running total under a single "velocity" label. Each cell
 *     now carries its own window, and the contradictions cell is a real
 *     30d slice instead of a number that could only ever go up.
 *   · health was rendered "/100" even when a dimension was unmeasurable.
 *     It now renders out of the max actually available this run.
 */
function LearningVelocityScoreboard() {
  const { data, isError } = trpc.journal.learningVelocity.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });
  // This digest has no empty state — it always returns numbers — so the
  // only reason data is missing is that the read failed. Say so.
  if (isError) return <ReadingUnavailable label="Learning velocity" />;
  if (!data) return null;
  const pct = data.memoryPctChange30d;
  return (
    <div className="rounded-surface border border-edge-subtle bg-content p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-fg-tertiary">
          Learning velocity
        </p>
        <p
          className={cn(
            "text-[11px] font-mono tabular-nums",
            pct === null
              ? "text-[var(--text-tertiary)]"
              : pct > 0
                ? "text-emerald-300"
                : pct < 0
                  ? "text-rose-300"
                  : "text-[var(--text-tertiary)]",
          )}
        >
          {/* pct === null means the prior 30-day window held zero memories,
              so a percent change is undefined. Say that, rather than
              rendering a 0% that would read as "no change". */}
          {pct === null
            ? `memories ${data.memoriesLast30d} in 30d · no prior window to compare`
            : `memories ${pct > 0 ? "+" : ""}${pct}% vs prior 30d`}
          {" · health "}
          {data.healthScore}/{data.healthScoreMax}
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 text-[11px] font-mono">
        <ScoreboardCell
          label="memories · 7d"
          value={data.memoriesThisWeek}
          delta={data.memoriesDelta}
        />
        {/* "wisdom rows", not "wisdom promotions" — this counts rows created
            in the wisdom category, which a distiller run or a batch of chat
            scrapes also lands in. The real promotion path stamps
            metadata.promotedFromCandidate and is not measured here. */}
        <ScoreboardCell
          label="wisdom rows · 30d"
          value={data.wisdomCreated30d}
          delta={null}
        />
        <ScoreboardCell
          label="connections · 30d"
          value={data.newConnections30d}
          delta={null}
        />
        <ScoreboardCell
          label="contradictions resolved · 30d"
          value={data.contradictionsResolved30d}
          delta={null}
        />
      </div>
    </div>
  );
}

function ScoreboardCell({
  label,
  value,
  delta,
}: {
  label: string;
  value: number;
  delta: number | null;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[var(--text-tertiary)] truncate">{label}</span>
      <span className="text-[var(--text-primary)] tabular-nums">{value}</span>
      {delta !== null && delta !== 0 && (
        <span
          className={cn(
            "text-[11px] tabular-nums",
            delta > 0 ? "text-emerald-400/70" : "text-rose-400/70",
          )}
        >
          ({delta > 0 ? "+" : ""}{delta})
        </span>
      )}
    </div>
  );
}

/**
 * Wave V #2 · Calibration tile.
 *
 * `summarizeCalibration` returns hitRate + meanBrier + verdict +
 * avgClaimVsRealityGap. Brier scores are populated on every resolved
 * Prediction by the outcome-tracker cron. Pre-Wave-V zero UI rendered
 * it · only PredictionStreaksCard's hit-rate displayed (which is
 * calibration-blind per the helper's own header comment).
 *
 * Silent when resolved === 0 — a genuinely quiet 30 days shows nothing, per
 * the page's silent-when-empty rule. A FAILED read is not that: it renders
 * explicitly (2026-09-02). The helper used to swallow Prisma errors into
 * `resolved: 0`, so an unreachable database and a quiet month were the same
 * pixel — this tile vanished, and the operator read that as "calibration is
 * fine". The window itself was also wrong: it filtered on `createdAt`, which
 * structurally excluded every prediction with a horizon of 30 days or more.
 * It now keys on resolution time.
 */
function CalibrationTile() {
  const { data, isError } = trpc.brain.calibrationSummary.useQuery(
    { days: 30 },
    { refetchOnWindowFocus: false, staleTime: 5 * 60 * 1000 },
  );
  if (isError) return <ReadingUnavailable label="Calibration" />;
  if (!data || data.resolved === 0) return null;
  // Verdict map matches the helper's enum: "well-calibrated" |
  // "drift" | "unknown" · drift is the warning signal (>= 15% off).
  const verdictTint =
    data.verdict === "well-calibrated"
      ? "text-emerald-300"
      : data.verdict === "drift"
        ? "text-amber-300"
        : "text-[var(--text-tertiary)]";
  return (
    <div className="rounded-surface border border-[var(--border-default)] bg-[var(--bg-void)]/40 p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        {/* "resolved 30d", not "30d" — the population is predictions that
            RESOLVED in the last 30 days, whenever they were made. */}
        <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-fg-tertiary">
          Calibration · resolved 30d
        </p>
        <p className={cn("text-[11px] font-mono tabular-nums", verdictTint)}>
          {data.verdict.replace(/-/g, " ")}
        </p>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1.5 text-[11px] font-mono">
        <span>
          <span className="text-[var(--text-tertiary)] mr-1">mean Brier</span>
          <span className="text-[var(--text-primary)] tabular-nums">
            {data.meanBrier != null ? data.meanBrier.toFixed(3) : "—"}
          </span>
          <span className="text-[var(--text-tertiary)]/60 ml-1">
            (coin = 0.25)
          </span>
        </span>
        {data.hitRate !== null && (
          <span>
            <span className="text-[var(--text-tertiary)] mr-1">hit rate</span>
            <span className="text-[var(--text-primary)] tabular-nums">
              {Math.round(data.hitRate * 100)}%
            </span>
            <span className="text-[var(--text-tertiary)]/60 ml-1">
              · {data.confirmed}/{data.resolved}
            </span>
          </span>
        )}
        {data.avgClaimVsRealityGap !== null && (
          <span>
            <span className="text-[var(--text-tertiary)] mr-1">claim-vs-reality gap</span>
            <span className="text-[var(--text-primary)] tabular-nums">
              {Math.round(data.avgClaimVsRealityGap * 100)}%
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
