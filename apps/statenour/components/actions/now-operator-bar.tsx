"use client";

/**
 * NowOperatorBar · v10.0.311 · top section of the /tasks NOW-mode body.
 *
 * Extracted from app/(mastery)/tasks/page.tsx as Stage A of the
 * deferred nowContent extraction (the 833-LOC block sitting on the
 * elon-merge backlog since v10.0.273 ProjectCard extraction).
 *
 * Renders ·
 *   · Smart headline · time-aware, performance-aware · clicks open
 *     the 4-step weekly review wizard if reviewSet has entries
 *   · Weak-axis pulse chip · when brain.weakAxis is set (< 40/100),
 *     surfaces the dim worth working on this week · taps to /brain
 *   · Status counters · open count + done-today (color shifts red
 *     when afternoon-with-zero) + overdue + sparkline + DOING focus
 *     mode chip
 *   · Filter toggle + Refresh buttons · top-right
 *
 * Page-scope state ALL passed in via typed props · no global state
 * reads. Mirrors the v10.0.273 ProjectCard extraction pattern.
 */
import { Sparkline } from "@/components/ui/sparkline";
import { cn } from "@/lib/utils";
import { RefreshCw, SlidersHorizontal } from "lucide-react";

interface BrainContext {
  weakAxis?: string | null;
  maturity?: number | null;
}

export interface NowOperatorBarProps {
  // Headline + review wizard
  smartHeadline: string;
  /** v10.0.529.82 · Wave 26 · B2 · DOING tasks stuck >2h. When
   *  non-empty, a dismissible chip surfaces below the headline.
   *  Loose unknown[] shape because Task carries 30+ fields and we
   *  only use .id + .title + .length in this component. */
  stuckDoing?: ReadonlyArray<{ id: string; title: string }>;
  reviewSet: unknown[];
  setWizardOpen: (open: boolean) => void;
  // Weak-axis pulse
  brain: BrainContext | null;
  // Status counters
  active: unknown[];
  doneToday: number;
  isAfternoon: boolean;
  hour12: number;
  ampm: string;
  overdue: number;
  doneSpark: number[];
  // Focus mode
  doing: number;
  focusMode: boolean;
  setFocusMode: (updater: (prev: boolean) => boolean) => void;
  // Filters + refresh
  showFilters: boolean;
  setShowFilters: (updater: (prev: boolean) => boolean) => void;
  load: () => void;
}

export function NowOperatorBar({
  smartHeadline,
  stuckDoing,
  reviewSet,
  setWizardOpen,
  brain,
  active,
  doneToday,
  isAfternoon,
  hour12,
  ampm,
  overdue,
  doneSpark,
  doing,
  focusMode,
  setFocusMode,
  showFilters,
  setShowFilters,
  load,
}: NowOperatorBarProps) {
  return (
    /* ── Headline + status + controls · header row of the NOW-mode
       operator bar · parent /tasks page wraps this in a space-y-2
       container alongside the Quick-add row. */
    <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          {/* Apr 27 · the headline REVIEW button now opens the
              4-step weekly review wizard (was: dead-fire on a
              ReviewSheet that never landed visibly). Wizard handles
              triage warnings → confirm goals → confirm projects →
              pick top 3. Same button, real follow-through. */}
          {reviewSet.length > 0 ? (
            <button
              type="button"
              onClick={() => setWizardOpen(true)}
              className="text-left text-[13px] font-bold text-zinc-200 leading-snug hover:text-amber-300 transition-colors group"
            >
              <span>{smartHeadline}</span>
              <span className="ml-1.5 inline-flex items-center gap-0.5 align-middle text-[9px] font-medium uppercase tracking-wider text-amber-400 opacity-70 group-hover:opacity-100">
                → review
              </span>
            </button>
          ) : (
            <p className="text-[13px] font-bold text-zinc-200 leading-snug">
              {smartHeadline}
            </p>
          )}
          {/* v10.0.529.82 · Wave 26 · B2 · stuck-DOING chip · surfaces
              tasks that have been in flight > 2h so the operator can
              re-frame or break them down. Renders inline next to
              status counters · auto-hides when empty. */}
          {stuckDoing && stuckDoing.length > 0 && (
            <div className="mt-1 inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider text-amber-300">
              <span className="h-1 w-1 rounded-full bg-amber-400 animate-pulse" />
              {stuckDoing.length === 1
                ? `stuck · ${stuckDoing[0]!.title.slice(0, 40)}`
                : `${stuckDoing.length} stuck · re-frame?`}
            </div>
          )}
          {/* v10.0.274 · weak-axis pulse · 8-axis self-model surfacing
              the weakest dimension here keeps it visible on the
              operator bar so Nour sees what to work on this week.
              Renders only when actions-brain returned a weakAxis
              (i.e. weakest dimension < 40/100). Tap → /brain. */}
          {brain?.weakAxis && (
            <a
              href="/brain"
              className="mt-1 inline-flex items-center gap-1 rounded border border-rose-500/30 bg-rose-500/5 px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wider text-rose-300 hover:bg-rose-500/15 transition-colors"
              title={`Weakest axis · ${brain.weakAxis} · tap → /brain to review`}
            >
              <span className="h-1 w-1 rounded-full bg-rose-400 animate-pulse" />
              weak axis · {brain.weakAxis}
              {typeof brain.maturity === "number" && (
                <span className="text-rose-400/60 ml-1">
                  · {brain.maturity}/100
                </span>
              )}
            </a>
          )}
          <div className="flex items-center gap-2 mt-0.5 text-[9px] text-zinc-600 font-mono">
            {/* 2026-05-24 · Wave U ux-F5 · AnimatedCounter on these 3
                status counters fired on every visibility-change /
                event-bus refresh · ticked from 0 simultaneously for
                zero information gain · same AI-slop class as the
                /journal chip counts (Wave R). Plain spans with
                tabular-nums match /settings + /journal vocabulary. */}
            <span className="text-amber-400 tabular-nums">{active.length}</span>
            <span>open</span>
            <span className="text-zinc-800">·</span>
            <span className={cn(
              "tabular-nums",
              // Apr 26 · F2 — afternoon-with-zero-done is a wake-up
              // signal. Color shifts red and a tiny clock anchor
              // appears so the visual lies match the number's truth.
              doneToday === 0 && isAfternoon
                ? "text-red-400"
                : "text-emerald-400"
            )}>
              {doneToday}
            </span>
            <span>done</span>
            {doneToday === 0 && isAfternoon && (
              <span className="text-zinc-700 italic">
                ({hour12}{ampm})
              </span>
            )}
            {overdue > 0 && (
              <>
                <span className="text-zinc-800">·</span>
                <span className="text-red-400 tabular-nums">{overdue}</span>
                <span>late</span>
              </>
            )}
            {doneSpark.some((v) => v > 0) && (
              <Sparkline data={doneSpark} width={48} height={14} color="rgb(52 211 153)" showDot={false} animate={false} />
            )}
            {/* Apr 26 · F12 — focus chip. Renders only when at
                least one task is DOING. Tap → hide everything else.
                Tap again → restore the full stream. */}
            {doing > 0 && (
              <>
                <span className="text-zinc-800">·</span>
                <button
                  type="button"
                  onClick={() => setFocusMode((v) => !v)}
                  className={cn(
                    "px-1.5 py-0.5 rounded border font-mono uppercase tracking-wider transition-colors text-[8px]",
                    focusMode
                      ? "text-blue-300 bg-blue-500/15 border-blue-500/40"
                      : "text-blue-400 border-blue-500/20 hover:bg-blue-500/10"
                  )}
                  title={focusMode ? "Show all tasks" : "Show only DOING"}
                >
                  {focusMode ? "✕ focus" : `${doing} doing · focus`}
                </button>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0 mt-0.5">
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={cn(
              "p-1.5 rounded-lg transition-colors",
              showFilters
                ? "text-amber-400 bg-amber-500/10"
                : "text-zinc-700 hover:text-zinc-400"
            )}
            title="Filters + search"
          >
            <SlidersHorizontal size={12} />
          </button>
          <button
            onClick={load}
            className="p-1.5 rounded-lg text-zinc-700 hover:text-zinc-400 transition-colors"
            title="Refresh"
          >
            <RefreshCw size={11} />
          </button>
        </div>
      </div>
  );
}
