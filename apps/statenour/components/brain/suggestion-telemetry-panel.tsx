"use client";

/**
 * SuggestionTelemetryPanel — live cache-hit + AI vs heuristic
 * split for the /api/ai/chat/suggestions endpoint. Helps Nour see
 * whether the two-layer warming actually pays off.
 *
 * Pulls /api/ai/chat/suggestions/stats every 15s. Numbers are lambda-
 * local (reset on cold start) so treat as "recent" not "lifetime."
 */

import { cn } from "@/lib/utils";
import { GlassCard } from "@/components/ui/glass-card";
import { Sparkles, Zap, Brain, AlertCircle } from "lucide-react";
// Phase B.6d (2026-05-22) · migrated off `authedFetch("/api/ai/chat/
// suggestions/stats")` onto `trpc.brain.suggestionStats` · reactive
// read · the 15s `setInterval` is now React Query's refetchInterval.
import { trpc } from "@/lib/trpc/client";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { AnimatedCounter } from "@/components/ui/animated-counter";

interface Stats {
  requests: number;
  cacheHits: number;
  cacheHitRate: number;
  aiOk: number;
  aiFail: number;
  heuristic: number;
  errorFallback: number;
  avgLatencyMs: number;
  p50Ms: number;
  p95Ms: number;
  sample: number;
}

export function SuggestionTelemetryPanel() {
  // The endpoint returns a `live`/`history24` envelope PLUS the flat
  // legacy keys the panel binds — the procedure preserves that shape,
  // so the `Stats` projection off the top level is unchanged.
  const statsQuery = trpc.brain.suggestionStats.useQuery(undefined, {
    refetchInterval: 15_000,
  });
  const stats = (statsQuery.data as Stats | undefined) ?? null;
  const loadedAt = statsQuery.dataUpdatedAt || null;

  if (!stats && !statsQuery.isError) {
    return (
      <GlassCard className="p-4">
        <div className="text-[11px] text-[var(--text-tertiary)]">
          Suggestion telemetry — loading…
        </div>
      </GlassCard>
    );
  }

  if (statsQuery.isError && !stats) {
    return (
      <GlassCard className="p-4">
        <div className="flex items-center gap-2 text-[11px] text-red-400">
          <AlertCircle size={12} /> telemetry load failed:{" "}
          {statsQuery.error.message}
        </div>
      </GlassCard>
    );
  }

  if (!stats) return null;

  const hitPct = Math.round(stats.cacheHitRate * 100);
  const aiTotal = stats.aiOk + stats.aiFail;
  const aiSuccessPct =
    aiTotal > 0 ? Math.round((stats.aiOk / aiTotal) * 100) : null;
  const heuristicPct =
    stats.requests > 0 ? Math.round((stats.heuristic / stats.requests) * 100) : 0;

  return (
    <GlassCard className="p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Sparkles size={14} className="text-[var(--gold)]" />
        <h2 className="text-[13px] font-[var(--font-display)] font-bold uppercase tracking-wider text-[var(--text-primary)]">
          Smart Replies — Live Telemetry
        </h2>
        <FreshnessChip lastFetchedAt={loadedAt} source="lambda" compact onReload={() => void statsQuery.refetch()} />
        <span className="text-[10px] text-[var(--text-tertiary)]">lambda-local</span>
      </div>

      {stats.requests === 0 ? (
        <p className="text-[11px] text-[var(--text-tertiary)]">
          No suggestion requests yet this lambda. Interact with chat to generate data.
        </p>
      ) : (
        <>
          {/* Hit-rate bar */}
          <div>
            <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
              <span>cache hit rate</span>
              <span
                className={cn(
                  hitPct >= 50
                    ? "text-emerald-400"
                    : hitPct >= 25
                      ? "text-amber-400"
                      : "text-red-400"
                )}
              >
                {hitPct}% ({stats.cacheHits}/{stats.requests})
              </span>
            </div>
            <div className="h-1.5 bg-[var(--bg-elevated)] rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full transition-all",
                  hitPct >= 50
                    ? "bg-emerald-400"
                    : hitPct >= 25
                      ? "bg-amber-400"
                      : "bg-red-400"
                )}
                style={{ width: `${Math.max(2, hitPct)}%` }}
              />
            </div>
          </div>

          {/* Source split */}
          <div className="grid grid-cols-4 gap-2 text-[10px] font-mono uppercase tracking-wider">
            <div className="flex flex-col gap-0.5">
              <span className="text-[var(--text-tertiary)]">cache</span>
              <span className="text-emerald-400 text-[12px] tabular-nums">
                <AnimatedCounter value={stats.cacheHits} duration={600} />
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[var(--text-tertiary)]">ai</span>
              <span className="text-[var(--gold)] text-[12px] tabular-nums">
                <AnimatedCounter value={stats.aiOk} duration={600} />
                {aiSuccessPct !== null && stats.aiFail > 0 && (
                  <span className="text-[9px] text-[var(--text-tertiary)] ml-1">
                    /{aiSuccessPct}% ok
                  </span>
                )}
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[var(--text-tertiary)]">heuristic</span>
              <span
                className={cn(
                  "text-[12px] tabular-nums",
                  heuristicPct > 40 ? "text-amber-400" : "text-[var(--text-secondary)]"
                )}
              >
                <AnimatedCounter value={stats.heuristic} duration={600} />
              </span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[var(--text-tertiary)]">errors</span>
              <span
                className={cn(
                  "text-[12px]",
                  stats.errorFallback > 0 ? "text-red-400" : "text-[var(--text-secondary)]"
                )}
              >
                {stats.errorFallback}
              </span>
            </div>
          </div>

          {/* Latency */}
          <div className="flex items-center gap-3 text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
            <span className="flex items-center gap-1">
              <Zap size={10} /> avg {stats.avgLatencyMs}ms
            </span>
            <span>p50 {stats.p50Ms}ms</span>
            <span
              className={cn(
                stats.p95Ms > 2000
                  ? "text-red-400"
                  : stats.p95Ms > 1000
                    ? "text-amber-400"
                    : "text-emerald-400/70"
              )}
            >
              p95 {stats.p95Ms}ms
            </span>
            <span className="ml-auto">{stats.sample} samples</span>
          </div>

          {/* Interpretation helper */}
          {hitPct < 20 && stats.requests > 5 && (
            <div className="flex items-center gap-2 text-[10px] text-amber-400/80 border-l-2 border-amber-400/40 pl-2">
              <Brain size={10} />
              low cache hit — consider widening the warm window or
              pre-warming on more surfaces
            </div>
          )}
          {aiSuccessPct !== null && aiSuccessPct < 70 && (
            <div className="flex items-center gap-2 text-[10px] text-red-400/80 border-l-2 border-red-400/40 pl-2">
              <AlertCircle size={10} />
              ai success rate low ({aiSuccessPct}%) — heuristic
              fallback is carrying the load
            </div>
          )}
        </>
      )}
    </GlassCard>
  );
}
