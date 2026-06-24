import React from "react";
import { trpc } from "@/lib/trpc";
import { TrendingUp, BarChart3, Globe, Crosshair } from "lucide-react";

export function MarketIntelligence() {
  const { data: report, isLoading } = trpc.intelligence.masterReport.useQuery(undefined, {
    refetchInterval: 60000,
  });

  if (isLoading) {
    return <div className="h-48 flex items-center justify-center text-muted-foreground text-xs animate-pulse">Loading market intelligence...</div>;
  }

  const content = report?.marketing?.contentPerformance as any;
  const reviewVel = report?.marketing?.reviewVelocity as any;
  const compGap = report?.competitive?.competitorGap as any;
  const channelROI = report?.marketing?.channelROI as any;

  const topPage = content?.topPages?.[0];
  const velocity = reviewVel?.velocity || 0;
  const topChannel = channelROI?.channels?.sort((a: any, b: any) => b.roi - a.roi)?.[0];
  const missingServices = compGap?.missingServices || [];

  return (
    <div className="bg-card border border-border/40 p-5 space-y-5 rounded-xl shadow-sm">
      <div className="flex items-center gap-2 pb-2 border-b border-border/10">
        <Globe className="w-5 h-5 text-cyan-400" />
        <h2 className="text-sm font-black text-cyan-400 tracking-wide uppercase">Market Intelligence</h2>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 bg-background/50 border border-border/40 rounded-lg">
          <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-wider uppercase text-muted-foreground mb-1">
            <TrendingUp className="w-3.5 h-3.5" /> Review Velocity
          </div>
          <div className="text-xl font-black text-foreground">
            {velocity > 0 ? "+" : ""}{velocity}%
          </div>
          <div className="text-[10px] text-muted-foreground font-medium mt-1">MoM Growth</div>
        </div>

        <div className="p-3 bg-background/50 border border-border/40 rounded-lg">
          <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-wider uppercase text-muted-foreground mb-1">
            <BarChart3 className="w-3.5 h-3.5" /> Top Channel
          </div>
          <div className="text-xl font-black text-foreground capitalize">
            {topChannel?.channel || "N/A"}
          </div>
          <div className="text-[10px] text-muted-foreground font-medium mt-1">
            {topChannel ? `${topChannel.roi}x ROI` : "No data"}
          </div>
        </div>
      </div>

      <div className="space-y-4 pt-2">
        <div>
          <h3 className="text-[11px] font-bold tracking-[0.15em] uppercase text-foreground/50 mb-2 flex items-center gap-1.5">
            <Crosshair className="w-3 h-3" /> Competitor Gaps
          </h3>
          {missingServices.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {missingServices.map((s: string, i: number) => (
                <span key={i} className="px-2 py-1 bg-cyan-500/10 text-cyan-400 text-[10px] font-bold rounded uppercase tracking-wider">
                  {s}
                </span>
              ))}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground py-2 italic bg-foreground/[0.02] px-3 rounded-md border border-border/20">
              No significant service gaps detected vs local competitors.
            </div>
          )}
        </div>

        <div>
          <h3 className="text-[11px] font-bold tracking-[0.15em] uppercase text-foreground/50 mb-2">Top Content</h3>
          {topPage ? (
            <div className="p-3 bg-background/50 border border-border/40 rounded-lg flex justify-between items-center">
              <div className="truncate pr-4">
                <div className="text-xs font-semibold text-foreground truncate">{topPage.page}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{topPage.leads} leads generated</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-black text-cyan-400">{topPage.conversionRate}%</div>
                <div className="text-[9px] uppercase tracking-wider text-muted-foreground">Conv. Rate</div>
              </div>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground py-2 italic bg-foreground/[0.02] px-3 rounded-md border border-border/20">
              Not enough data to determine top performing content.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
