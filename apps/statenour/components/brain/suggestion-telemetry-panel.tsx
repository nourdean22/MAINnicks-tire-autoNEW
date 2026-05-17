"use client";

/**
 * SuggestionTelemetryPanel — live cache-hit + Venice vs heuristic
 * split for the /api/ai/chat/suggestions endpoint. Helps Nour see
 * whether the two-layer warming actually pays off.
 *
 * Pulls /api/ai/chat/suggestions/stats every 15s. Numbers are lambda-
 * local (reset on cold start) so treat as "recent" not "lifetime."
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { GlassCard } from "@/components/ui/glass-card";
import { Sparkles, Zap, Brain, AlertCircle } from "lucide-react";
import { authedFetch } from "@/hooks/use-authed-fetch";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { AnimatedCounter } from "@/components/ui/animated-counter";

interface Stats {
  requests: number;
  cacheHits: number;
  cacheHitRate: number;
  veniceOk: number;
  veniceFail: number;
  heuristic: number;
  errorFallback: number;
  avgLatencyMs: number;
  p50Ms: number;
  p95Ms: number;
  sample: number;
}

export function SuggestionTelemetryPanel() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await authedFetch("/api/ai/chat/suggestions/stats");
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as Stats;
        if (!cancelled) {
          setStats(data);
          setError(null);
          setLoadedAt(Date.now());
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "load failed");
      }
    }
    void load();
    const id = setInterval(load, 15_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [nonce]);

  if (!stats && !error) {
    return (
      <GlassCard className="p-4">
        <div className="text-[11px] text-[var(--text-tertiary)]">
          Suggestion telemetry — loading…
        </div>
      </GlassCard>
    );
  }

  if (error && !stats) {
    return (
      <GlassCard className="p-4">
        <div className="flex items-center gap-2 text-[11px] text-red-400">
          <AlertCircle size={12} /> telemetry load failed: {error}
        </div>
      </GlassCard>
    );
  }

  if (!stats) return null;

  const hitPct = Math.round(stats.cacheHitRate * 100);
  const veniceTotal = stats.veniceOk + stats.veniceFail;
  const veniceSuccessPct =
    veniceTotal > 0 ? Math.round((stats.veniceOk / veniceTotal) * 100) : null;
  const heuristicPct =
    stats.requests > 0 ? Math.round((stats.heuristic / stats.requests) * 100) : 0;

  return (
    <GlassCard className="p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Sparkles size={14} className="text-[var(--gold)]" />
        <h2 className="text-[13px] font-[var(--font-display)] font-bold uppercase tracking-wider text-[var(--text-primary)]">
          Smart Replies — Live Telemetry
        </h2>
        <FreshnessChip lastFetchedAt={loadedAt} source="lambda" compact onReload={() => setNonce((n) => n + 1)} />
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
              <span className="text-[var(--text-tertiary)]">venice</span>
              <span className="text-[var(--gold)] text-[12px] tabular-nums">
                <AnimatedCounter value={stats.veniceOk} duration={600} />
                {veniceSuccessPct !== null && stats.veniceFail > 0 && (
                  <span className="text-[9px] text-[var(--text-tertiary)] ml-1">
                    /{veniceSuccessPct}% ok
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
          {veniceSuccessPct !== null && veniceSuccessPct < 70 && (
            <div className="flex items-center gap-2 text-[10px] text-red-400/80 border-l-2 border-red-400/40 pl-2">
              <AlertCircle size={10} />
              venice success rate low ({veniceSuccessPct}%) — heuristic
              fallback is carrying the load
            </div>
          )}
        </>
      )}
    </GlassCard>
  );
}
