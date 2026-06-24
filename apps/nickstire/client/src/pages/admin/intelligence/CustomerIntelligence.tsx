import React from "react";
import { trpc } from "@/lib/trpc";
import { Users, PhoneCall, MessageSquare, AlertTriangle, RefreshCw } from "lucide-react";

export function CustomerIntelligence() {
  const { data: nbaData, isLoading: nbaLoading } = trpc.intelligence.nextBestActions.useQuery(undefined, {
    refetchInterval: 60000,
  });

  const { data: report, isLoading: reportLoading } = trpc.intelligence.masterReport.useQuery(undefined, {
    refetchInterval: 60000,
  });

  if (nbaLoading || reportLoading) {
    return <div className="h-48 flex items-center justify-center text-muted-foreground text-xs animate-pulse">Loading customer signals...</div>;
  }

  // Filter for VIP winbacks
  const vips = nbaData?.actions.filter(a => a.type === "vip_winback") || [];

  // Get churn risk summary
  const churnObj = report?.customers?.churnRisk as any;
  const highRiskCount = churnObj?.highRisk?.length || 0;
  
  // Get repeat predictions summary
  const repeatObj = report?.customers?.repeatPrediction as any;
  const recommendedCount = repeatObj?.recommendations?.length || 0;

  return (
    <div className="bg-card border border-border/40 p-5 space-y-5 rounded-xl shadow-sm">
      <div className="flex items-center gap-2 pb-2 border-b border-border/10">
        <Users className="w-5 h-5 text-indigo-400" />
        <h2 className="text-sm font-black text-indigo-400 tracking-wide uppercase">Customer Intelligence</h2>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 bg-red-500/5 border border-red-500/20 rounded-lg flex items-center gap-3">
          <div className="p-2 bg-red-500/10 rounded-md">
            <AlertTriangle className="w-4 h-4 text-red-400" />
          </div>
          <div>
            <div className="text-xl font-black text-foreground leading-none">{highRiskCount}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mt-1">High Churn Risk</div>
          </div>
        </div>
        <div className="p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-lg flex items-center gap-3">
          <div className="p-2 bg-emerald-500/10 rounded-md">
            <RefreshCw className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <div className="text-xl font-black text-foreground leading-none">{recommendedCount}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mt-1">Due For Maintenance</div>
          </div>
        </div>
      </div>

      <div className="space-y-3 pt-2">
        <h3 className="text-[11px] font-bold tracking-[0.15em] uppercase text-foreground/50 mb-1">VIPs Going Cold</h3>
        {vips.length === 0 ? (
          <div className="text-xs text-muted-foreground py-2 italic bg-foreground/[0.02] px-3 rounded-md border border-border/20">
            No VIPs currently detected as going cold. Retention looks solid.
          </div>
        ) : (
          vips.map((vip, i) => (
            <div key={i} className="flex items-start justify-between gap-3 p-3 bg-background/50 border border-border/40 rounded-lg group">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-foreground truncate">{vip.message}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-[10px] font-bold ${vip.urgency >= 4 ? 'text-red-400' : 'text-amber-400'}`}>Urgency: {vip.urgency}/5</span>
                  {vip.phone && <span className="text-[10px] text-muted-foreground font-mono">{vip.phone}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button className="p-1.5 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 rounded-md transition-colors" title="Call">
                  <PhoneCall className="w-3.5 h-3.5" />
                </button>
                <button className="p-1.5 bg-green-500/10 text-green-400 hover:bg-green-500/20 rounded-md transition-colors" title="SMS">
                  <MessageSquare className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
