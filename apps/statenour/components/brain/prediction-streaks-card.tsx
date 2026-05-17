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

import { useCallback, useEffect, useState } from "react";
import { GlassCard } from "@/components/ui/glass-card";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { Sparkline } from "@/components/ui/sparkline";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { authedFetch } from "@/hooks/use-authed-fetch";
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
  const [report, setReport] = useState<StreaksReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch("/api/brain/prediction-streaks");
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const j = (await res.json()) as { data?: StreaksReport } & StreaksReport;
      // apiHandler envelope unwraps {data: ...}; raw shape also accepted.
      setReport(j.data ?? (j as StreaksReport));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !report) {
    return (
      <GlassCard>
        <p className="text-[11px] text-[var(--text-tertiary)]">loading prediction streaks…</p>
      </GlassCard>
    );
  }

  if (error && !report) {
    return (
      <GlassCard>
        <div className="flex items-center justify-between">
          <p className="text-[11px] text-rose-400">streaks unavailable: {error}</p>
          <button
            onClick={() => void load()}
            className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--gold)]"
          >
            retry
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
          <TrendingUp size={14} className="text-[var(--gold)]" />
          <span className="section-label">Prediction streaks</span>
        </div>
        <FreshnessChip
          lastFetchedAt={report.computedAt}
          source="api/brain/prediction-streaks"
          onReload={() => void load()}
          compact
        />
      </div>

      {/* Top active — celebrate the longest unbroken streak.
          v8.3 alive-UI: AnimatedCounter on the streak number ticks up
          on first paint; Sparkline next to it shows progress (1, 2, …,
          currentStreak) so the eye sees the run, not just the digit. */}
      {topActive && topActive.currentStreak > 0 && (
        <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3 mb-3">
          <div className="flex items-center gap-2">
            <Flame size={14} className="text-emerald-400 animate-pulse" />
            <span className="text-[11px] font-mono uppercase tracking-wider text-emerald-400 inline-flex items-center gap-1">
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
            <span className="ml-auto text-[10px] text-[var(--text-tertiary)] font-mono">
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
              className="rounded-md border border-rose-500/30 bg-rose-500/5 p-2.5 flex items-center gap-2"
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
              className="rounded border border-[var(--border-default)] bg-zinc-900/30 p-2 flex items-center justify-between"
            >
              <span className="text-[10px] text-[var(--text-secondary)]">{c.category}</span>
              <span className="text-[10px] font-mono tabular-nums text-[var(--text-tertiary)]">
                <span className="text-[var(--gold)]">{c.currentStreak}</span>
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
