import React from "react";
import { trpc } from "@/lib/trpc";
import { Clock, Zap, AlertCircle, PhoneIncoming } from "lucide-react";
import { LoadingState } from "../shared";
import { ProvenanceTag } from "../shared/ProvenanceTag";
import { deriveLeadSla } from "./leadSla";

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

  // Q-23 phase 5 · a failed engine, a failed read and an empty window each
  // used to fall through `|| 0` into the same emerald "Avg: 0m". See ./leadSla.
  const sla = deriveLeadSla(report?.marketing?.leadResponse);
  const avgMins = sla.avgMinutes;
  const under5Conv = sla.under5.rate ?? 0;
  const over1hConv = sla.over1h.rate ?? 0;
  const avgTone =
    avgMins === null
      ? "bg-foreground/5 text-foreground/50"
      : avgMins <= 15
        ? "bg-emerald-500/10 text-emerald-400"
        : avgMins <= 60
          ? "bg-yellow-500/10 text-yellow-400"
          : "bg-red-500/10 text-red-400";
  const avgText = sla.state === "unread" ? "Avg: unknown" : avgMins === null ? "Avg: none" : `Avg: ${avgMins}m`;
  const convLine = (b: { leads: number; rate: number | null }) =>
    b.rate === null ? "no leads to convert" : `${b.rate}% conversion rate`;

  return (
    <div className="bg-card border border-border/40 p-5 space-y-5 rounded-xl shadow-sm">
      <div className="flex items-center justify-between pb-2 border-b border-border/10">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-fuchsia-400" />
          <h2 className="text-sm font-black text-fuchsia-400 tracking-wide uppercase">Lead SLA Monitor</h2>
        </div>
        <div className="flex items-center gap-1.5">
          <div data-sla-avg className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${avgTone}`}>
            {avgText}
          </div>
          <ProvenanceTag provenance={sla.provenance} />
        </div>
      </div>

      {sla.state === "unread" && (
        <p data-sla-unread className="text-xs text-muted-foreground">
          Lead response times could not be read. They are <strong className="text-amber-400">unknown</strong>, not 0 minutes.
        </p>
      )}
      {sla.state === "empty" && (
        <p data-sla-empty className="text-xs text-muted-foreground">
          No lead was contacted in the last 90 days, so there is no response time to average.
        </p>
      )}

      {sla.state !== "unread" && (
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 bg-background/50 border border-border/40 rounded-lg flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-wider uppercase text-emerald-400">
            <Zap className="w-3.5 h-3.5" /> Under 5 Min
          </div>
          <div className="text-xl font-black text-foreground">{sla.under5.leads} leads</div>
          <div className="text-[10px] text-muted-foreground font-medium">{convLine(sla.under5)}</div>
        </div>
        
        <div className="p-3 bg-red-500/5 border border-red-500/20 rounded-lg flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-[10px] font-bold tracking-wider uppercase text-red-400">
            <AlertCircle className="w-3.5 h-3.5" /> Over 1 Hour
          </div>
          <div className="text-xl font-black text-foreground">{sla.over1h.leads} leads</div>
          <div className="text-[10px] text-muted-foreground font-medium">{convLine(sla.over1h)}</div>
        </div>
      </div>
      )}

      {sla.state !== "unread" && (
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
      )}
    </div>
  );
}
