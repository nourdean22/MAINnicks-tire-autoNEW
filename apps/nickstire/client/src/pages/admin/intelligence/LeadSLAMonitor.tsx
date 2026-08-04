import React from "react";
import { trpc } from "@/lib/trpc";
import { Clock, Zap, AlertCircle, PhoneIncoming } from "lucide-react";
import { LoadingState } from "../shared";

export function LeadSLAMonitor() {
  const { data: report, isLoading, isError, error } = trpc.intelligence.masterReport.useQuery(undefined, {
    refetchInterval: 60000,
  });

  if (isLoading) {
    return <LoadingState label="Loading SLA metrics..." />;
  }

  // UNKNOWN IS NOT ZERO. A failed report used to fall through `|| 0` into an
  // EMERALD "Avg: 0m" — a failed read rendered as a perfect response time.
  if (isError) {
    return (
      <div className="bg-card border border-amber-500/30 p-5 rounded-xl shadow-sm">
        <div className="flex items-center gap-2 pb-2">
          <Clock className="w-5 h-5 text-amber-400" />
          <h2 className="text-sm font-black text-amber-400 tracking-wide uppercase">Lead SLA Monitor</h2>
        </div>
        <p className="text-xs text-muted-foreground">SLA metrics could not be read — response times are <strong className="text-amber-400">unknown</strong>, not 0 minutes. {error?.message}</p>
      </div>
    );
  }

  const leadResp = report?.marketing?.leadResponse as any;
  const avgMins = leadResp?.avgMinutes || 0;
  const under5 = leadResp?.under5min || 0;
  const over1h = leadResp?.over1hour || 0;
  const conversions = leadResp?.conversionBySpeed || [];

  const under5Conv = conversions.find((c: any) => c.bucket === "Under 5 min")?.rate || 0;
  const over1hConv = conversions.find((c: any) => c.bucket === "Over 1 hour")?.rate || 0;

  return (
    <div className="bg-card border border-border/40 p-5 space-y-5 rounded-xl shadow-sm">
      <div className="flex items-center justify-between pb-2 border-b border-border/10">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-fuchsia-400" />
          <h2 className="text-sm font-black text-fuchsia-400 tracking-wide uppercase">Lead SLA Monitor</h2>
        </div>
        <div className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${avgMins <= 15 ? 'bg-emerald-500/10 text-emerald-400' : avgMins <= 60 ? 'bg-yellow-500/10 text-yellow-400' : 'bg-red-500/10 text-red-400'}`}>
          Avg: {avgMins}m
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 bg-background/50 border border-border/40 rounded-lg flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-wider uppercase text-emerald-400">
            <Zap className="w-3.5 h-3.5" /> Under 5 Min
          </div>
          <div className="text-xl font-black text-foreground">{under5} leads</div>
          <div className="text-[10px] text-muted-foreground font-medium">{under5Conv}% conversion rate</div>
        </div>
        
        <div className="p-3 bg-red-500/5 border border-red-500/20 rounded-lg flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-wider uppercase text-red-400">
            <AlertCircle className="w-3.5 h-3.5" /> Over 1 Hour
          </div>
          <div className="text-xl font-black text-foreground">{over1h} leads</div>
          <div className="text-[10px] text-muted-foreground font-medium">{over1hConv}% conversion rate</div>
        </div>
      </div>

      <div className="space-y-3 pt-2">
        <h3 className="text-[11px] font-bold tracking-[0.15em] uppercase text-foreground/50 mb-1">Impact Analysis</h3>
        {under5Conv > 0 && over1hConv > 0 ? (
          <div className="p-3 bg-fuchsia-500/5 border border-fuchsia-500/20 rounded-lg">
            <p className="text-xs text-foreground leading-snug">
              Responding under 5 minutes converts at <span className="font-bold text-emerald-400">{under5Conv}%</span>, 
              compared to <span className="font-bold text-red-400">{over1hConv}%</span> after an hour.
              <br/><br/>
              <span className="text-muted-foreground text-[11px]">Keep average response time under 15 minutes to maximize throughput.</span>
            </p>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground py-2 italic bg-foreground/[0.02] px-3 rounded-md border border-border/20">
            Not enough recent conversion data across time buckets to analyze impact.
          </div>
        )}
      </div>
    </div>
  );
}
