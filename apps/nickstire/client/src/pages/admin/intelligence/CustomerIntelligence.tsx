import React from "react";
import { trpc } from "@/lib/trpc";
import { Users, PhoneCall, MessageSquare, AlertTriangle, RefreshCw } from "lucide-react";
import { LoadingState } from "../shared";
import { ProvenanceTag } from "../shared/ProvenanceTag";
import { deriveCustomerSignals, type CustomerSignalCount } from "./customerSignals";

export function CustomerIntelligence() {
  const { data: nbaData, isLoading: nbaLoading, isError: nbaError } = trpc.intelligence.nextBestActions.useQuery(undefined, {
    refetchInterval: 60000,
  });

  const { data: report, isLoading: reportLoading, isError: reportError } = trpc.intelligence.masterReport.useQuery(undefined, {
    refetchInterval: 60000,
  });

  if (nbaLoading || reportLoading) {
    return <LoadingState label="Loading customer signals..." />;
  }

  // A FAILED read must not render as "Retention looks solid". Before this, a
  // rejected masterReport left highRiskCount/recommendedCount at 0 and the card
  // showed two zeros plus an explicit all-clear — a retention verdict produced
  // by a query that never succeeded. On a phone that reads as good news.
  if (reportError || nbaError) {
    return (
      <div className="bg-card border border-amber-500/30 p-5 rounded-xl">
        <div className="flex items-center gap-2 pb-2 border-b border-border/10">
          <Users className="w-5 h-5 text-amber-400" />
          <h2 className="text-sm font-black text-amber-400 tracking-wide uppercase">Customer Intelligence</h2>
        </div>
        <div className="flex items-center gap-2 mt-4 text-amber-200/90 text-xs">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>Customer signals could not be read — churn and retention status unknown, not clear.</span>
        </div>
      </div>
    );
  }

  // Filter for VIP winbacks
  const vips = nbaData?.actions.filter(a => a.type === "vip_winback") || [];

  // Q-23 phase 6 · "Due For Maintenance" read a field its engine never
  // returns, so it was always 0; a failed churn engine also painted 0. Each
  // tile now shows "unknown" (UNMEASURED) or its count (ESTIMATE). See
  // ./customerSignals.
  const { churnHighRisk, dueSoon } = deriveCustomerSignals(report?.customers);

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
            <SignalValue signal={churnHighRisk} name="churn" />
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mt-1">High Churn Risk</div>
          </div>
        </div>
        <div className="p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-lg flex items-center gap-3">
          <div className="p-2 bg-emerald-500/10 rounded-md">
            <RefreshCw className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <SignalValue signal={dueSoon} name="due" />
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mt-1">Due Or Overdue</div>
          </div>
        </div>
      </div>

      <div className="space-y-3 pt-2">
        <h3 className="text-[11px] font-bold tracking-[0.15em] uppercase text-foreground/50 mb-1">VIPs Going Cold</h3>
        {vips.length === 0 ? (
          <div className="text-xs text-muted-foreground py-2 italic bg-foreground/[0.02] px-3 rounded-md border border-border/20">
            No VIP win-back made the top 8 actions right now. Higher-urgency leads, invoices and callbacks can fill the list, so this is not a retention verdict.
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

/** A tile number: "unknown" in grey when unread, never a confident 0. */
function SignalValue({ signal, name }: { signal: CustomerSignalCount; name: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        data-signal={name}
        className={`text-xl font-black leading-none ${signal.read ? "text-foreground" : "text-foreground/40 italic"}`}
      >
        {signal.display}
      </div>
      <ProvenanceTag provenance={signal.provenance} />
    </div>
  );
}
