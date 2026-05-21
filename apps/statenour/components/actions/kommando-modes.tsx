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
import { Zap, Target } from "lucide-react";
import { KommandoPlan, type PlanLinkedProjectChip } from "./mode-plan";
import { CaptureChip } from "./capture-chip";
import { TipChip } from "@/components/ui/tip-chip";
import { LEARN_TIPS, type LearnTipKey } from "@/lib/learn/tips";

export type KommandoMode = "NOW" | "PLAN";

const STORAGE_KEY = "nour:kommando:mode";
const VALID_MODES: readonly KommandoMode[] = ["NOW", "PLAN"];

/** Default mode based on time of day. Overridden by localStorage. */
function pickDefaultMode(): KommandoMode {
  if (typeof window === "undefined") return "NOW";
  const h = new Date().getHours();
  if (h >= 22 || h < 6) return "PLAN"; // night → reflective planning
  return "NOW"; // day → execute
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
      // Legacy stored values ("REVIEW"/"LEARN"/"TRACK" — all retired
      // when the TRACK tab was distributed out, 2026-05-21) aren't in
      // VALID_MODES, so they fall through to the time-of-day default.
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && (VALID_MODES as readonly string[]).includes(stored)) {
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

  // ── Keyboard number nav (1-2 switches modes) ──
  // Works globally when focus isn't in an input/textarea.
  // 1=NOW 2=PLAN. Shift+number is ignored to not collide
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
  const MODES_ORDER: KommandoMode[] = ["NOW", "PLAN"];
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
        </>
      )}
    </div>
  );
}
