"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import {
  TrendingUp,
  TrendingDown,
  Activity,
  AlertTriangle,
  Zap,
  Info,
  Calendar,
  LineChart,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { ErrorCard } from "@/components/ui/error-card";

export function IdentityArcCard() {
  const [activeTab, setActiveTab] = useState<"projection" | "growth">("projection");

  const projQ = trpc.operator.identityProjection.useQuery({ days: 30 }, {
    staleTime: 60_000,
  });
  
  const growthQ = trpc.operator.xpGrowthComparison.useQuery(undefined, {
    staleTime: 60_000,
  });

  const isLoading = projQ.isLoading || growthQ.isLoading;
  const isError = projQ.error || growthQ.error;

  if (isLoading) {
    return (
      <div className="h-[200px] rounded-lg border border-white/10 bg-white/[0.02] animate-pulse" />
    );
  }

  if (isError) {
    const errorMsg = projQ.error?.message || growthQ.error?.message || "Identity projections failed to load.";
    return (
      <ErrorCard
        title="Failed to load Identity Arc"
        message={errorMsg}
        domain="operator:identityProjection"
        onRetry={() => {
          if (projQ.error) void projQ.refetch();
          if (growthQ.error) void growthQ.refetch();
        }}
      />
    );
  }

  const trajectories = projQ.data?.trajectories ?? [];
  const growth = growthQ.data ?? [];

  const totalGained30d = growth.reduce((sum, g) => sum + g.gained30d, 0);
  const totalGained60d = growth.reduce((sum, g) => sum + g.gained60d, 0);
  const totalGained90d = growth.reduce((sum, g) => sum + g.gained90d, 0);
  const totalGained180d = growth.reduce((sum, g) => sum + g.gained180d, 0);

  const momXp = totalGained30d;
  const priorMomXp = totalGained60d - totalGained30d;
  const momPct = priorMomXp > 0 ? ((momXp - priorMomXp) / priorMomXp) * 100 : 0;

  const qoqXp = totalGained90d;
  const priorQoqXp = totalGained180d - totalGained90d;
  const qoqPct = priorQoqXp > 0 ? ((qoqXp - priorQoqXp) / priorQoqXp) * 100 : 0;

  // Sort growth to find top active and stalled stats
  const topActive = [...growth]
    .sort((a, b) => b.gained30d - a.gained30d)
    .filter(g => g.gained30d > 0)
    .slice(0, 3);

  const stalled = [...growth]
    .filter(g => g.gained30d === 0 && g.gained180d > 0)
    .slice(0, 3);

  return (
    <section
      aria-label="identity-arc-card"
      className="rounded-lg border border-white/10 bg-white/[0.02] p-3.5 flex flex-col justify-between space-y-3 min-h-[195px]"
    >
      <div className="flex items-center justify-between border-b border-white/[0.06] pb-2">
        <p className="text-[10px] uppercase tracking-[0.18em] text-white/40">
          Identity evolution & arc
        </p>
        <div className="flex gap-1">
          <button
            onClick={() => setActiveTab("projection")}
            className={cn(
              "px-2 py-0.5 rounded text-[10px] font-semibold transition uppercase tracking-[0.06em]",
              activeTab === "projection"
                ? "bg-white/[0.08] text-white"
                : "text-white/40 hover:text-white/60"
            )}
          >
            30d Projection
          </button>
          <button
            onClick={() => setActiveTab("growth")}
            className={cn(
              "px-2 py-0.5 rounded text-[10px] font-semibold transition uppercase tracking-[0.06em]",
              activeTab === "growth"
                ? "bg-white/[0.08] text-white"
                : "text-white/40 hover:text-white/60"
            )}
          >
            XP Growth
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto max-h-[140px] scrollbar-thin">
        {activeTab === "projection" ? (
          <div className="space-y-2">
            {trajectories.length === 0 ? (
              <p className="text-[11px] text-white/50">No trajectory projections available.</p>
            ) : (
              <div className="grid grid-cols-1 gap-1.5 text-[11px]">
                {trajectories.map((t) => {
                  const isPositive = t.delta30d > 0;
                  const isZero = t.delta30d === 0;
                  
                  return (
                    <div
                      key={t.axis}
                      className="flex items-center justify-between py-1 px-1.5 rounded bg-white/[0.01] border border-white/[0.03] hover:border-white/[0.08]"
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="truncate font-medium text-white/80">
                          {t.label}
                        </span>
                        {t.warning && (
                          <span
                            title={`Warning: ${t.warning}`}
                            className={cn(
                              "inline-flex text-[9px] px-1 rounded-full",
                              t.warning.includes("decline") || t.warning === "below_30"
                                ? "bg-rose-500/10 text-rose-400"
                                : "bg-amber-500/10 text-amber-400"
                            )}
                          >
                            ⚠️
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 tabular-nums">
                        <span className="text-white/50">{t.currentValue}</span>
                        <span className="text-white/30">→</span>
                        <span className="font-semibold text-white/95">{t.projectedValue30d}</span>
                        <span
                          className={cn(
                            "flex items-center gap-0.5 font-medium min-w-[45px] justify-end",
                            isZero
                              ? "text-white/40"
                              : isPositive
                              ? "text-emerald-400"
                              : "text-rose-400"
                          )}
                        >
                          {!isZero && (isPositive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />)}
                          {isZero ? "stable" : `${isPositive ? "+" : ""}${t.delta30d}`}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3 text-[11px]">
            {/* MoM / QoQ Trend Metrics Grid */}
            <div className="grid grid-cols-2 gap-2 border-b border-white/6 pb-2">
              <div className="p-2 rounded bg-white/1 border border-white/4">
                <p className="text-[9px] uppercase tracking-wider text-white/40">MoM Growth</p>
                <div className="flex items-baseline justify-between mt-0.5">
                  <span className="text-xs font-semibold text-white">{momXp.toFixed(0)} XP</span>
                  <span className={cn("text-[10px] font-semibold flex items-center gap-0.5", momPct >= 0 ? "text-emerald-400" : "text-rose-400")}>
                    {momPct >= 0 ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                    {momPct >= 0 ? "+" : ""}{momPct.toFixed(0)}%
                  </span>
                </div>
              </div>
              <div className="p-2 rounded bg-white/1 border border-white/4">
                <p className="text-[9px] uppercase tracking-wider text-white/40">QoQ Growth</p>
                <div className="flex items-baseline justify-between mt-0.5">
                  <span className="text-xs font-semibold text-white">{qoqXp.toFixed(0)} XP</span>
                  <span className={cn("text-[10px] font-semibold flex items-center gap-0.5", qoqPct >= 0 ? "text-emerald-400" : "text-rose-400")}>
                    {qoqPct >= 0 ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                    {qoqPct >= 0 ? "+" : ""}{qoqPct.toFixed(0)}%
                  </span>
                </div>
              </div>
            </div>

            {topActive.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[9px] uppercase tracking-widest text-emerald-400 font-semibold flex items-center gap-1">
                  <Zap className="h-2.5 w-2.5" /> Top 3 Active stats (30d)
                </p>
                <div className="grid grid-cols-1 gap-1">
                  {topActive.map((g) => (
                    <div
                      key={g.stat}
                      className="flex items-center justify-between px-1.5 py-0.5 bg-emerald-500/2 rounded border border-emerald-500/10"
                    >
                      <span className="text-white/80">
                        {g.icon} {g.label}
                      </span>
                      <span className="font-semibold text-emerald-400">+{g.gained30d} XP</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {stalled.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[9px] uppercase tracking-widest text-rose-400/90 font-semibold flex items-center gap-1">
                  <Activity className="h-2.5 w-2.5" /> Stalled stats (Active past 180d, 0 XP in 30d)
                </p>
                <div className="grid grid-cols-1 gap-1">
                  {stalled.map((g) => (
                    <div
                      key={g.stat}
                      className="flex items-center justify-between px-1.5 py-0.5 bg-rose-500/2 rounded border border-rose-500/10"
                    >
                      <span className="text-white/60">
                        {g.icon} {g.label}
                      </span>
                      <span className="text-white/40">stalled</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {topActive.length === 0 && stalled.length === 0 && (
              <p className="text-white/50">No XP growth comparisons calculated yet.</p>
            )}
          </div>
        )}
      </div>

      <div className="text-[9px] text-white/30 flex items-center gap-1 border-t border-white/4 pt-2">
        <Info className="h-2.5 w-2.5" />
        {activeTab === "projection" 
          ? "Linear regression over 14d snap history."
          : "Rolling sum comparison of all non-task + task events."}
      </div>
    </section>
  );
}
