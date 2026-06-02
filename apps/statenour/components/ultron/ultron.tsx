"use client";

/**
 * ULTRON — the composition root.
 *
 * Reads NourState + the signal API once, classifies the current mode,
 * and assembles the top strip + today + signal + ask zones.
 *
 * Layout:
 *   ┌───── top strip (sticky) ────────────────────┐
 *   │  ticker                                     │
 *   │  wordmark  mode-pill  [pulse chips]         │
 *   ├──────────────────────────────────────────────┤
 *   │  today                                       │
 *   │  ask                                         │
 *   │  signal                                      │
 *   └──────────────────────────────────────────────┘
 *
 * Ask sits above signal deliberately — the capture box is the most
 * frequent interaction, and signal needs room to cycle. On wider screens
 * we'll lay out two columns in v2.
 */

// v10.0.529.48 · /ultron AGGRESSIVE-CUT redesign. Operator: "too much
// going on it's confusing". Applied ELON delete-first + redesign-
// existing-projects skill audit + ux-audit Nielsen lens. Cuts:
//   · LensFireTicker (overlapped BottomPulseTicker · pure noise)
//   · ObservabilityRow → /system (ops-grade · not daily-driver)
//   · DecisionReplayCard → /brain (reflection-tier · not today-tier)
//   · ContradictionsCard → /brain (self-model surface · not daily)
//   · PreferencesCard → /brain (settings-tier · not daily)
//   · PersonaDriftCard → /brain (diagnostic-tier · not daily)
// Result: 13 cards → 7 cards. SignalZone PROMOTED to top (it IS the
// meta-narrative · was buried at bottom). Survivors ordered by
// cognitive-time: read-this-first → what-changed → vitals →
// today-anchor → today-questions → resume → work.
import { useMemo } from "react";
import { CommandCore } from "@/components/3d/command-core";
import type { CommandCoreAlertLevel } from "@/components/3d/scenes/command-core-scene";
import { TodayPulseStrip } from "@/components/ultron/today-pulse-strip";
import { ResumeLastWork } from "@/components/ultron/resume-last-work";
import { MITSlot } from "@/components/ultron/mit-slot";
import { useNourState } from "@/lib/state/nour-state";
import { today } from "@/lib/utils/datetime";
import { useIdleWarmup } from "@/hooks/use-idle-warmup";
import { classifyMode, type UltronMode, type ClassifierResult } from "@/lib/ultron/mode-classifier";
import { useUltronFetch } from "@/lib/ultron/client-cache";
import { TopStrip } from "./top-strip/top-strip";
import { TodayZone } from "./today/today-zone";
import { SignalZone } from "./signal/signal-zone";
import { SinceLastVisitCard } from "./since-last-visit-card";
// v10.0.529.35 · Arc B F6 · today's 3 anticipated questions · each tap
// seeds /chat with the question + a precomputed answer.
import { AnticipatedQuestionsCard } from "./anticipated-questions-card";
import { MemoryGraphExplorer } from "@/components/brain/memory-graph-explorer";
// GhostNickStrip retired from HQ Apr 20 — folded into the unified
// Situation card as a ghost-source candidate. Still renders on /brain
// via the brain-page composition where it has more room to show the
// accuracy scoreboard + dismissals.

interface SignalCounts {
  blindSpots: { critical: number; high: number; medium: number; low: number; total: number };
}
interface SignalShape {
  counts?: SignalCounts;
}

// v10.0.73 · drift-budget wire-up. Pulse endpoint already exposes the
// shape the mode classifier needs; we just dedupe with PulseStack via
// the shared useUltronFetch cache key.
interface PulseShape {
  mind?: { driftBudget?: { current: number; cap: number } };
}

// v10.0.529.106 · Wave 63 · body data feeds the MODE classifier so
// sleep < 6h forces RECOVERY etc. Shape mirrors /api/body GET response.
interface BodyEntry {
  date: string;
  sleepHours?: number | null;
  energy?: number | null;
}
interface BodyShape {
  entries?: BodyEntry[];
}

export function Ultron() {
  const s = useNourState();
  // Warm the chat lambda in the background — if Nour switches to
  // /chat from HQ, the prompt cache is already hot.
  useIdleWarmup();
  // Shared Ultron fetch — same cache key the signal zone uses so we don't
  // fire a second identical request. The classifier only needs `counts`.
  const { data: signalData } = useUltronFetch<SignalShape>("/api/ultron/signal", {
    ttlMs: 300_000,
    pollMs: 300_000,
  });
  const signalCounts: SignalCounts | null = signalData?.counts ?? null;

  // v10.0.73 · pulse fetch dedupes with PulseStack (same cache key + TTL).
  // Drift budget = open drift alerts as a % of soft cap (10). Mode
  // classifier flips to RECOVERY at 70%. Pre-fix this was a hardcoded 0
  // so the RECOVERY-by-drift branch in mode-classifier.ts never fired.
  const { data: pulseData } = useUltronFetch<PulseShape>("/api/ultron/pulse", {
    ttlMs: 60_000,
    pollMs: 60_000,
  });
  const driftBudget = pulseData?.mind?.driftBudget;
  const driftBudgetUsed = driftBudget && driftBudget.cap > 0
    ? Math.round((driftBudget.current / driftBudget.cap) * 100)
    : 0;

  // v10.0.529.106 · Wave 63 · pull the most recent body entry so the
  // mode classifier can react to sleep + energy. Cached aggressively
  // (15min) · the entry is daily-cadence so polling faster wastes calls.
  const { data: bodyData } = useUltronFetch<BodyShape>("/api/body?range=30d", {
    ttlMs: 15 * 60_000,
    pollMs: 15 * 60_000,
  });
  const latestBody = bodyData?.entries?.[bodyData.entries.length - 1] ?? null;
  const todayStr = today();
  // Only feed sleep+energy into the classifier if the entry is from today.
  // Stale data is worse than no data · pretending we have signal when we
  // don't would force RECOVERY mode for days after a single bad sleep night.
  const todayBody = latestBody && latestBody.date === todayStr ? latestBody : null;

  const classifier: ClassifierResult = classifyMode({
    currentState: s.currentState,
    timeOfDay: s.timeOfDay,
    todayScore: s.todayScore,
    habitsDone: s.habitsDone,
    habitsTotal: s.habitsTotal,
    overdueCommitments: s.overdueCommitments,
    staleLeads: s.staleLeads,
    agingCritical: s.agingCritical,
    blindSpotsCritical: signalCounts?.blindSpots.critical ?? 0,
    blindSpotsHigh: signalCounts?.blindSpots.high ?? 0,
    driftBudgetUsed,
    sleepHours: todayBody?.sleepHours ?? null,
    energy: todayBody?.energy ?? null,
  });

  const mode: UltronMode = classifier.mode;

  // 2026-05-24 · Wave X.c · derive CommandCore scene props from the
  // signals this component already pulls — no extra fetch. The R3F
  // backdrop's contract is { healthScore, alertLevel, situationCount }
  // (see components/3d/scenes/command-core-scene.tsx).
  //   · healthScore = 100 - driftBudgetUsed → the drift budget is the
  //     OS's "noise floor"; a clean signal layer reads as a bright,
  //     stable core. Clamped 0..100.
  //   · alertLevel = critical blind-spots → "critical"; high blind-
  //     spots OR drift > 70% → "warn"; else "info". Mirrors the rim
  //     color of the wireframe core to system state.
  //   · situationCount = stale leads + aging critical + overdue +
  //     critical/high blind-spots. Drives a faint scale pulse so the
  //     core visibly grows under load.
  const blindSpotsCritical = signalCounts?.blindSpots.critical ?? 0;
  const blindSpotsHigh = signalCounts?.blindSpots.high ?? 0;
  const commandCoreData = useMemo(() => {
    const alertLevel: CommandCoreAlertLevel =
      blindSpotsCritical > 0
        ? "critical"
        : blindSpotsHigh > 0 || driftBudgetUsed > 70
          ? "warn"
          : "info";
    const healthScore = Math.max(0, Math.min(100, 100 - driftBudgetUsed));
    const situationCount =
      (s.staleLeads ?? 0) +
      (s.agingCritical ?? 0) +
      (s.overdueCommitments ?? 0) +
      blindSpotsCritical +
      blindSpotsHigh;
    return { healthScore, alertLevel, situationCount };
  }, [
    blindSpotsCritical,
    blindSpotsHigh,
    driftBudgetUsed,
    s.staleLeads,
    s.agingCritical,
    s.overdueCommitments,
  ]);

  return (
    // Apr 19 · Dropped `min-h-screen` + `flex-col` + `flex-1` from the
    // Ultron root. The outer (mastery) layout already applies
    // `min-h-screen` on its <main>, so stacking them was pushing the
    // ticker well below the viewport AND leaving a huge dead zone
    // underneath when content was shorter than 100vh. Content now flows
    // naturally — top strip, content column, bottom ticker — no
    // phantom gap.
    <div className="text-[var(--text-primary)] relative">
      {/* v10.0.291 · CommandCore R3F backdrop · sits behind data.
          opacity-50 keeps the 3D subtle so data legibility wins ·
          fixed positioning so the backdrop persists across scroll for
          an OS-landing feel. 2026-05-24 (Wave X.c) · now DATA-REACTIVE:
          drift budget drives core integrity · blind-spot severity
          shifts the wireframe rim color · situation load pulses the
          core scale. The backdrop reads as the OS state, not decor. */}
      <CommandCore
        className="fixed inset-0 -z-10 opacity-50 pointer-events-none"
        data={commandCoreData}
      />
      <TopStrip mode={mode} reason={classifier.reason} />

      <div className="max-w-3xl w-full mx-auto px-3 py-4 space-y-4">
        {/* v10.0.529.48 · NEW ORDER · cognitive-time flow.
            Operator-feedback: "too much going on · confusing".
            Audit + cut shipped via redesign-existing-projects skill +
            ELON delete-first lens. 13 → 7 cards on /ultron. */}

        {/* 1 · SIGNAL ZONE — promoted from bottom to TOP. This is
            the meta-narrative ("read this first") · folds narrator +
            bets + rumination + calibration + pin hygiene + ghost +
            contradiction + persona-drift into ONE ranked candidate.
            Burying it was the central misuse · it's THE first read. */}
        <SignalZone />

        {/* 2 · SINCE LAST VISIT — "what changed while I was away".
            Silent on empty cursor · tinted summary + 3 recent links
            when there's delta. Keeps HQ feeling like a feed. */}
        <SinceLastVisitCard />

        {/* 3 · TODAY PULSE — 6-chip ambient vitals (weak axis · top
            lens · VAPI · system · cost · positions). Each chip
            deep-links to its full dashboard. Silent on cold-start. */}
        <TodayPulseStrip />

        {/* 4 · MIT — today's ONE binary anchor. The outcome that
            matters today · distinct from the todo list. Persists
            per-day. */}
        <MITSlot />

        {/* 5 · ANTICIPATED — top-3 forward-looking questions for
            today · each tap seeds /chat with a precomputed answer.
            Silent on cold-start or quiet 7d window. */}
        <AnticipatedQuestionsCard />

        {/* 6 · RESUME — "Continue X · paused Yh ago" pill · removes
            the "where was I?" friction. Silent while mid-flow. */}
        <ResumeLastWork />

        {/* 7 · TODAY ZONE — forcing functions · TodoDesk +
            NextActionWhisperer. The actual work surface. */}
        <TodayZone />

        {/* Relocated (operator-driven cut · v10.0.529.48):
            · ObservabilityRow  → /system  (ops-grade telemetry)
            · DecisionReplayCard → /brain  (30d-out reflection)
            · ContradictionsCard → /brain  (self-model resolver)
            · PreferencesCard    → /brain  (8-axis settings)
            · PersonaDriftCard   → /brain  (reply-alignment review)
            · LensFireTicker     → cut entirely (overlap noise) */}
      </div>

      {/* Bottom Pulse Ticker — personal ambient signal. Scrolls
       *  captures / MIT / tomorrow / narrator / commitments /
       *  reflection freshness / wins + "Nick noticed today" rollup
       *  (today's brain_insight events). Replaces the old
       *  TodaysCaptures card that used to occupy premium HQ real
       *  estate.
       *
       *  v7.3 · Apr 29 · Lifted to global mastery layout so it
       *  persists across ALL pages. Removed from HQ-only mount. */}

      {/* Memory Graph Explorer — click any auto-linker chip anywhere
       *  in the app and this modal pops up with the edge network.
       *  Listens on window events, mounts once at shell level. */}
      <MemoryGraphExplorer />
    </div>
  );
}
