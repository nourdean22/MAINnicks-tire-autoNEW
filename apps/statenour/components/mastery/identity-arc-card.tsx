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

  if (isError) return null;

  const trajectories = projQ.data?.trajectories ?? [];
  const growth = growthQ.data ?? [];

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
            {topActive.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[9px] uppercase tracking-[0.1em] text-emerald-400 font-semibold flex items-center gap-1">
                  <Zap className="h-2.5 w-2.5" /> Top 3 Active stats (30d)
                </p>
                <div className="grid grid-cols-1 gap-1">
                  {topActive.map((g) => (
                    <div
                      key={g.stat}
                      className="flex items-center justify-between px-1.5 py-0.5 bg-emerald-500/[0.02] rounded border border-emerald-500/10"
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
                <p className="text-[9px] uppercase tracking-[0.1em] text-rose-400/90 font-semibold flex items-center gap-1">
                  <Activity className="h-2.5 w-2.5" /> Stalled stats (Active past 180d, 0 XP in 30d)
                </p>
                <div className="grid grid-cols-1 gap-1">
                  {stalled.map((g) => (
                    <div
                      key={g.stat}
                      className="flex items-center justify-between px-1.5 py-0.5 bg-rose-500/[0.02] rounded border border-rose-500/10"
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

      <div className="text-[9px] text-white/30 flex items-center gap-1 border-t border-white/[0.04] pt-2">
        <Info className="h-2.5 w-2.5" />
        {activeTab === "projection" 
          ? "Linear regression over 14d snap history."
          : "Rolling sum comparison of all non-task + task events."}
      </div>
    </section>
  );
}
