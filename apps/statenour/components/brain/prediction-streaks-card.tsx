"use client";

/**
 * PredictionStreaksCard · v8.2 · Apr 29.
 *
 * Brain-page card that consumes /api/brain/prediction-streaks (v8.1)
 * and surfaces:
 *   · the top active streak (positive reinforcement)
 *   · any fresh streak-breaks from the last 24h (alert)
 *   · per-category accuracy mini-grid (sortable hit-rate × current run)
 *
 * D5: shows lastFetchedAt + source via FreshnessChip.
 */

import { GlassCard } from "@/components/ui/glass-card";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { Sparkline } from "@/components/ui/sparkline";
import { AnimatedCounter } from "@/components/ui/animated-counter";
// Phase B.6d (2026-05-22) · migrated off `authedFetch("/api/brain/
// prediction-streaks")` onto `trpc.brain.predictionStreaks` · reactive
// read.
import { trpc } from "@/lib/trpc/client";
import { Flame, AlertTriangle, TrendingUp } from "lucide-react";

interface CategoryStreak {
  category: string;
  currentStreak: number;
  longestStreak: number;
  totalGraded: number;
  hitRate: number;
  brokenJustNow: boolean;
  lastGradedAt: string | null;
}

interface StreaksReport {
  computedAt: string;
  byCategory: CategoryStreak[];
  freshBreaks: CategoryStreak[];
  topActive: CategoryStreak | null;
}

export function PredictionStreaksCard() {
  // v8.2 · React Query drives the fetch · the card used a one-shot
  // `load()` (no interval) · same here.
  const streaksQuery = trpc.brain.predictionStreaks.useQuery(undefined);
  const report = (streaksQuery.data as StreaksReport | undefined) ?? null;

  if (streaksQuery.isLoading && !report) {
    return (
      <GlassCard>
        <p className="text-[11px] text-[var(--text-tertiary)]">loading prediction streaks…</p>
      </GlassCard>
    );
  }

  if (streaksQuery.isError && !report) {
    return (
      <GlassCard>
        <div className="flex items-center justify-between">
          <p className="text-[11px] text-rose-400">
            streaks unavailable: {streaksQuery.error.message}
          </p>
          <button
            onClick={() => void streaksQuery.refetch()}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-control border border-edge-default px-4 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg"
          >
            Retry
          </button>
        </div>
      </GlassCard>
    );
  }

  if (!report) return null;

  const topActive = report.topActive;
  const breaks = report.freshBreaks;
  const others = report.byCategory.filter(
    (c) => c.category !== topActive?.category && !c.brokenJustNow,
  );

  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <TrendingUp size={14} className="text-fg-secondary" />
          <span className="section-label">Prediction streaks</span>
        </div>
        <FreshnessChip
          lastFetchedAt={report.computedAt}
          source="api/brain/prediction-streaks"
          onReload={() => void streaksQuery.refetch()}
          compact
        />
      </div>

      {/* Top active — celebrate the longest unbroken streak.
          v8.3 alive-UI: AnimatedCounter on the streak number ticks up
          on first paint; Sparkline next to it shows progress (1, 2, …,
          currentStreak) so the eye sees the run, not just the digit. */}
      {topActive && topActive.currentStreak > 0 && (
        <div className="rounded-control border border-emerald-500/20 bg-emerald-500/5 p-3 mb-3">
          <div className="flex items-center gap-2">
            <Flame size={14} className="text-emerald-400" />
            <span className="text-[11px] font-mono text-emerald-400 inline-flex items-center gap-1">
              <AnimatedCounter value={topActive.currentStreak} duration={700} />
              -streak · {topActive.category}
            </span>
            <Sparkline
              data={Array.from(
                { length: Math.min(topActive.currentStreak, 16) },
                (_, i) => i + 1,
              )}
              width={56}
              height={14}
              color="#34d399"
              showDot
              animate
              className="ml-2"
            />
            <span className="ml-auto text-[11px] text-[var(--text-tertiary)] font-mono">
              best: {topActive.longestStreak} · hit rate: {(topActive.hitRate * 100).toFixed(0)}%
            </span>
          </div>
        </div>
      )}

      {/* Fresh breaks — surface as alerts */}
      {breaks.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {breaks.map((b) => (
            <div
              key={b.category}
              className="rounded-control border border-rose-500/30 bg-rose-500/5 p-2.5 flex items-center gap-2"
            >
              <AlertTriangle size={13} className="text-rose-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-rose-300">
                  <span className="font-semibold">{b.category}</span> streak broke just now —
                  was {b.longestStreak} long, now {b.currentStreak}.
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Per-category mini grid */}
      {others.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5">
          {others.map((c) => (
            <div
              key={c.category}
              className="rounded-micro border border-[var(--border-default)] bg-content p-2 flex items-center justify-between"
            >
              <span className="text-[11px] text-[var(--text-secondary)]">{c.category}</span>
              <span className="text-[11px] font-mono tabular-nums text-[var(--text-tertiary)]">
                <span className="text-fg-secondary">{c.currentStreak}</span>
                <span className="mx-1 opacity-50">/</span>
                <span>{c.longestStreak}</span>
                <span className="ml-2 opacity-60">{(c.hitRate * 100).toFixed(0)}%</span>
              </span>
            </div>
          ))}
        </div>
      )}

      {report.byCategory.length === 0 && (
        <p className="text-[11px] text-[var(--text-tertiary)]">
          No graded predictions yet — once Nick predicts and you confirm/disprove,
          streaks light up here.
        </p>
      )}
    </GlassCard>
  );
}
