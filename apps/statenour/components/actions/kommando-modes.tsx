"use client";

/**
 * KommandoModes — the 3-mode shell that turns the Actions page
 * into a full operator command deck.
 *
 * Apr 27 · Collapsed from 4 modes to 3. TRACK + LEARN merged. Nour
 * pointed out the duplication: TRACK is a numbers dashboard +
 * LEARN is a brief/research surface. Both fit comfortably stacked
 * on one tab. Merging keeps every feature both surfaces had — just
 * one less navigation step.
 *
 * Apr 20 · Earlier collapsed from 5 to 4 (REVIEW → LEARN).
 *
 * Modes now:
 *   NOW    — today's LoopStream (Ferrari view)
 *   PLAN   — Goal → Project → Task bridge
 *   TRACK  — dashboard top (streaks, trends, drift, completion) +
 *            brief / research / decisions / teach below (merged
 *            from the old LEARN tab)
 *
 * Each mode is lazy-loaded — only the active mode's data fetches.
 * Mode persists to localStorage. Legacy "REVIEW" + "LEARN" values
 * are quietly migrated to "TRACK" on hydrate so Nour's existing
 * preference lands on the right tab.
 *
 * Default mode is time-of-day aware:
 *   · morning/midday/afternoon → NOW   (execute)
 *   · evening (17-22)          → TRACK (debrief + numbers + brief)
 *   · night (22-6)             → PLAN  (reflection + planning)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Zap,
  Target,
  BarChart3,
} from "lucide-react";
import { KommandoPlan, type PlanLinkedProjectChip } from "./mode-plan";
import { KommandoTrack } from "./mode-track";
import { KommandoLearn } from "./mode-learn";
import { DailyBriefSection } from "./daily-brief-section";
import { CaptureChip } from "./capture-chip";
import { useOncePerSession } from "@/hooks/use-once-per-session";
import { TipChip } from "@/components/ui/tip-chip";
import { LEARN_TIPS, type LearnTipKey } from "@/lib/learn/tips";
import { RecentInsightsPanel } from "@/components/brain/recent-insights-panel";
import { MasteryRadar } from "@/components/actions/mastery-radar";

export type KommandoMode = "NOW" | "PLAN" | "TRACK";

const STORAGE_KEY = "nour:kommando:mode";
const VALID_MODES: readonly KommandoMode[] = ["NOW", "PLAN", "TRACK"];

/** Default mode based on time of day. Overridden by localStorage. */
function pickDefaultMode(): KommandoMode {
  if (typeof window === "undefined") return "NOW";
  const h = new Date().getHours();
  if (h >= 22 || h < 6) return "PLAN"; // night → reflective planning
  if (h >= 17) return "TRACK"; // evening → debrief + numbers (TRACK absorbed LEARN)
  return "NOW"; // morning/afternoon → execute
}

interface KommandoShellProps {
  /** The NOW mode content — rendered by the parent because it owns
   *  the existing LoopStream wiring and we don't want to re-thread
   *  all the task handlers. */
  nowContent: React.ReactNode;
  /** Optional extra content rendered inside the PLAN mode, below
   *  the KommandoPlan goals section. Used for the Projects block
   *  which needs access to the parent's task state + handlers. */
  planExtra?: React.ReactNode;
  /** Apr 20 bridge: Goal ↔ Project linkage so goal cards can render
   *  their linked projects inline and Nour can jump between levels. */
  goalToProjects?: Map<string, PlanLinkedProjectChip[]>;
  /** Called when Nour taps a project chip on a goal card. */
  onJumpToProject?: (projectId: string) => void;
  /** Called when Nour taps "Plan it" on a no-plan goal card. */
  onPlanGoal?: (goal: { id: string; title: string }) => void;
  /** Apr 27 · GB1 — fires when Nour taps a goal's "next move" chip
   *  on the PLAN tab. Parent switches to NOW + scrolls to the task. */
  onJumpToTask?: (taskId: string) => void;
  /** Apr 27 · GB4 — fires when the pace chip is tapped to spawn a
   *  daily-increment task. Parent creates a NOW task tagged with
   *  goalId so completion auto-lifts the goal. */
  onCreateTaskForGoal?: (args: {
    goalId: string;
    title: string;
    suggestedAmount: string;
  }) => Promise<void> | void;
  /** Fires when the active mode changes so the parent can pause
   *  polling for modes that don't need it (e.g. LEARN, REVIEW). */
  onModeChange?: (mode: KommandoMode) => void;
  /** Apr 27 · WEEKLY-REVIEW — TRACK's "Run weekly review" button +
   *  warning queue triage links call this so the parent (which owns
   *  the wizard mount) can open it. NOW headline does the same via
   *  its own button. */
  onOpenReview?: () => void;
}

// Mode pill labels · plain English · operator-grade. All three pills
// share ONE accent (gold) when active · the icon + label do the
// differentiating. FRONTEND-DESIGN rule: ONE dominant aesthetic
// direction.
//
// KommandoMode enum keys ("NOW" | "PLAN" | "TRACK") stay unchanged ·
// localStorage persistence + switch statements use the keys ·
// display labels are decoupled.
const MODE_META: Record<KommandoMode, { label: string; icon: React.ReactNode; tipKey: LearnTipKey }> = {
  NOW:   { label: "today",  icon: <Zap size={11} />,        tipKey: "mode_today" },
  PLAN:  { label: "goals",  icon: <Target size={11} />,     tipKey: "mode_goals" },
  TRACK: { label: "trends", icon: <BarChart3 size={11} />,  tipKey: "mode_trends" },
};
const ACTIVE_ACCENT = "text-[var(--gold)] border-[var(--gold)]/40";

export function KommandoShell({
  nowContent,
  planExtra,
  goalToProjects,
  onJumpToProject,
  onPlanGoal,
  onJumpToTask,
  onCreateTaskForGoal,
  onModeChange,
  onOpenReview,
}: KommandoShellProps) {
  const [mode, setMode] = useState<KommandoMode>("NOW");
  const [hydrated, setHydrated] = useState(false);

  // Hydrate mode from localStorage (with time-of-day fallback).
  // Apr 27 — legacy "REVIEW" + "LEARN" migrate to "TRACK" since the
  // tab was merged into the TRACK surface. Any other invalid value
  // falls through to pickDefaultMode.
  useEffect(() => {
    let initial: KommandoMode = "NOW";
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "REVIEW" || stored === "LEARN") {
        initial = "TRACK";
        localStorage.setItem(STORAGE_KEY, "TRACK");
      } else if (
        stored &&
        (VALID_MODES as readonly string[]).includes(stored)
      ) {
        initial = stored as KommandoMode;
      } else {
        initial = pickDefaultMode();
      }
    } catch {}
    setMode(initial);
    onModeChange?.(initial);
    setHydrated(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Apr 27 · GB1 — listen for cross-component mode-switch requests
  // (e.g. PLAN's next-move chip → switch to NOW). Single CustomEvent
  // bus avoids prop-drilling a setMode through the whole tree.
  useEffect(() => {
    const onSetMode = (e: Event) => {
      const detail = (e as CustomEvent<unknown>).detail;
      if (
        typeof detail === "string" &&
        (VALID_MODES as readonly string[]).includes(detail)
      ) {
        const next = detail as KommandoMode;
        setMode(next);
        try {
          localStorage.setItem(STORAGE_KEY, next);
        } catch {}
        onModeChange?.(next);
      }
    };
    window.addEventListener("nour:kommando:set-mode", onSetMode);
    return () => window.removeEventListener("nour:kommando:set-mode", onSetMode);
  }, [onModeChange]);

  // ── Brief auto-nudge ──
  // Once per session, if Nour opens the tasks page during a review
  // window (morning 6-9am or evening 8-11pm), show a toast offering
  // to jump to the trends tab (which hosts the daily brief).
  // v10.0.529.18 · sessionStorage gate + condition extracted into
  // <useOncePerSession>. Nudge-type is recomputed inside fn() because
  // it's cheap and keeps the condition body side-effect-free.
  useOncePerSession(
    "nour:review-nudge-shown",
    () => {
      if (!hydrated || mode === "TRACK") return false;
      const h = new Date().getHours();
      return (h >= 6 && h < 9) || (h >= 20 && h < 23);
    },
    () => {
      const h = new Date().getHours();
      const nudgeType = h >= 6 && h < 9 ? "morning" : "evening";
      toast(`${nudgeType === "morning" ? "morning" : "evening"} read is ready`, {
        description: `Nick's ${nudgeType} brief, ready when you are`,
        action: {
          label: "open trends",
          onClick: () => changeMode("TRACK"),
        },
        duration: 8000,
      });
    },
    [hydrated],
  );

  const changeMode = useCallback((next: KommandoMode) => {
    setMode(next);
    onModeChange?.(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {}
  }, [onModeChange]);

  const modePills = useMemo(
    () => (
      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar -mx-1 px-1 py-1">
        {VALID_MODES.map((k, idx) => {
          const meta = MODE_META[k];
          const active = mode === k;
          return (
            <div key={k} className="inline-flex items-center gap-0.5 shrink-0">
              <button
                onClick={() => changeMode(k)}
                aria-pressed={active}
                aria-label={`switch to ${meta.label}`}
                title={`${meta.label} (${idx + 1})`}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider border transition-all focus-visible:ring-1 focus-visible:ring-[var(--gold)] focus-visible:outline-none",
                  active
                    ? `${ACTIVE_ACCENT} bg-zinc-900/60`
                    : "text-zinc-600 hover:text-zinc-300 border-zinc-800/40 hover:border-zinc-700"
                )}
              >
                {meta.icon}
                {meta.label}
              </button>
              {/* v10.0.529.74 · Wave 20 · learn-anywhere · each mode pill
                  carries a TipChip so the operator can summon a 1-2
                  sentence explanation of the mode without leaving the
                  page. matches the "leaning installed throughout"
                  directive. */}
              <TipChip
                tip={LEARN_TIPS[meta.tipKey]}
                title={meta.label}
                size="xs"
              />
            </div>
          );
        })}
        {/* v10.0.529.74 · CaptureChip mounted at the end of the mode-pill
            strip · always reachable from any mode (today/goals/trends).
            Fires the existing brain-dump-modal which auto-classifies
            what you type · routes to journal/pins/decisions/memory. */}
        <CaptureChip className="ml-auto" />
      </div>
    ),
    [mode, changeMode]
  );

  // ── Keyboard number nav (1-3 switches modes) ──
  // Works globally when focus isn't in an input/textarea.
  // 1=NOW 2=PLAN 3=TRACK. Shift+number is ignored to not collide
  // with special chars.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const tag = target.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea" || target.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const modeByKey: Record<string, KommandoMode> = {
        "1": "NOW",
        "2": "PLAN",
        "3": "TRACK",
      };
      const target_mode = modeByKey[e.key];
      if (target_mode && target_mode !== mode) {
        e.preventDefault();
        changeMode(target_mode);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [mode, changeMode]);

  // ── Swipe between modes on mobile ──
  // Horizontal swipe left = next mode, right = prev mode. Same
  // thresholds as SwipeNavigation (80px dx, 1.5:1 h/v ratio, <400ms).
  const MODES_ORDER: KommandoMode[] = ["NOW", "PLAN", "TRACK"];
  const touchRef = useRef<{ x: number; y: number; time: number } | null>(null);

  useEffect(() => {
    const isMobile =
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 768px)").matches &&
      "ontouchstart" in window;
    if (!isMobile) return;

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      touchRef.current = { x: t.clientX, y: t.clientY, time: Date.now() };
    };
    const onEnd = (e: TouchEvent) => {
      if (!touchRef.current) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - touchRef.current.x;
      const dy = t.clientY - touchRef.current.y;
      const dt = Date.now() - touchRef.current.time;
      touchRef.current = null;

      const isSwipe = Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 1.5 && dt < 400;
      if (!isSwipe) return;

      const idx = MODES_ORDER.indexOf(mode);
      if (dx < 0 && idx < MODES_ORDER.length - 1) {
        changeMode(MODES_ORDER[idx + 1]);
      } else if (dx > 0 && idx > 0) {
        changeMode(MODES_ORDER[idx - 1]);
      }
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchend", onEnd);
    };
  }, [mode, changeMode]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-3">
      {/* Mode pills — always at the top */}
      {modePills}


      {/* Mode content — hydrated-gate so SSR and CSR agree */}
      {hydrated && (
        <>
          {mode === "NOW" && nowContent}
          {mode === "PLAN" && (
            <>
              <KommandoPlan
                goalToProjects={goalToProjects}
                onJumpToProject={onJumpToProject}
                onPlanGoal={onPlanGoal}
                onJumpToTask={onJumpToTask}
                onCreateTaskForGoal={onCreateTaskForGoal}
              />
              {planExtra}
            </>
          )}
          {mode === "TRACK" && (
            <div className="space-y-4">
              {/* Apr 27 · TRACK + LEARN merged. Stack order is the
                  read pattern Nour described:
                    1. Daily brief at the top — what to know right now
                    2. KommandoTrack — the numbers dashboard
                    3. KommandoLearn — research / teach / decisions
                  Each component fetches its own data + hides itself
                  when empty. */}
              <DailyBriefSection />
              {/* v10.0.529.80 · Wave 24 · #2 · mastery radar · 7d ago
                  vs now overlay. The gap between rings IS the
                  operator's compound interest visualized. Auto-hides
                  when fewer than 3 domains have history. */}
              <MasteryRadar />
              {/* v10.0.529.79 · Wave 23 · #4 · recent insights panel ·
                  surfaces the last 7 days of AI-enriched task_insight
                  rows grouped by 8-axis. Auto-hides when empty. */}
              <RecentInsightsPanel />
              <KommandoTrack
                onJumpMode={(m) => changeMode(m as KommandoMode)}
                onOpenReview={onOpenReview}
              />
              {/* Subtle divider so the dashboard and the brief/research
                  block don't blur together visually. */}
              <div className="flex items-center gap-2 pt-1">
                <div className="h-px flex-1 bg-zinc-800/40" />
                <span className="text-[8px] uppercase tracking-[0.2em] text-zinc-700 font-mono">
                  today · digging · learning
                </span>
                <div className="h-px flex-1 bg-zinc-800/40" />
              </div>
              <KommandoLearn onJumpMode={(m) => changeMode(m as KommandoMode)} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
