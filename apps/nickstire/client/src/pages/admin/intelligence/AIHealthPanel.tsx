import React, { useState } from "react";
import { Activity, AlertTriangle, TrendingUp, ShieldAlert, ChevronDown, ChevronUp } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { provenanceOf } from "@shared/tileProvenance";
import { ProvenanceTag } from "../shared/ProvenanceTag";

export function AIHealthPanel() {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const { data: report, isLoading, error } = trpc.intelligence.masterReport.useQuery(undefined, {
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <div className="stat-card p-5 animate-pulse">
        <div className="h-5 bg-muted rounded w-1/3 mb-4"></div>
        <div className="space-y-3">
          <div className="h-4 bg-muted/50 rounded w-full"></div>
          <div className="h-4 bg-muted/50 rounded w-4/5"></div>
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="stat-card p-5 border-red-500/20 bg-red-500/5">
        <div className="flex items-center gap-2 mb-2 text-red-400">
          <AlertTriangle className="w-5 h-5" />
          <h2 className="text-sm font-black tracking-wide uppercase">AI Health (Degraded)</h2>
        </div>
        <p className="text-sm text-red-400/80">Master intelligence unavailable: {error?.message}</p>
      </div>
    );
  }

  const { score, topAlert, topOpportunity, topRisk, scoreBreakdown, failures } = report.summary;
  // `scoreReliable` is optional here so an older cached report still renders.
  const scoreReliable = report.summary.scoreReliable !== false;
  const enginesFailed = report.summary.enginesFailed ?? 0;
  const enginesTotal = report.summary.enginesTotal ?? 0;

  // Determine score color
  let scoreColor = "text-emerald-400";
  if (score < 50) scoreColor = "text-red-400";
  else if (score < 70) scoreColor = "text-yellow-400";
  // An unreliable score is not a LOW score. The scale starts at a baseline of
  // 50 and each block is `if (engine)`, so a dead engine is absent from the
  // total rather than penalised — a total outage still renders 50/100, which
  // is amber-to-green on this scale and reads as "fine". Colour must not
  // imply health that was never measured.
  if (!scoreReliable) scoreColor = "text-amber-400";
  // Q-23 · the score is a weighted composite of heuristics, so a reliable one is
  // an ESTIMATE, never MEASURED. One whose engines mostly failed is UNMEASURED.
  const scoreProvenance = provenanceOf("modeled", scoreReliable ? "ok" : "unavailable");

  return (
    <div className="stat-card p-0 overflow-hidden border-indigo-500/20">
      <div className="p-5 bg-indigo-500/5 border-b border-border/20">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-indigo-400" />
            <h2 className="text-sm font-black text-indigo-400 tracking-wide uppercase">AI Health & Opportunities</h2>
          </div>
          <div className="text-right">
            <div className={`text-3xl font-black ${scoreColor}`}>{scoreReliable ? Math.round(score) : "—"}</div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-widest">
              {scoreReliable ? "Health Score" : "Score unavailable"}
            </div>
            <div data-score-provenance className="mt-1">
              <ProvenanceTag provenance={scoreProvenance} />
            </div>
          </div>
        </div>

        {/* An outage is stated where the number would be, not hidden on a
            collapsed accordion label. UNKNOWN, never a reassuring 50. */}
        {!scoreReliable && (
          <div role="alert" className="mb-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300">
            <strong>{enginesFailed} of {enginesTotal} intelligence engines failed.</strong>{" "}
            The health score is UNKNOWN, not average — it starts at a baseline of 50 and a dead
            engine is simply absent from it, so a number here would describe silence.
          </div>
        )}

        <div className="space-y-3 mt-4">
          <div className="flex items-start gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <div>
              <div className="text-xs font-bold text-red-400 uppercase tracking-wider mb-0.5">Top Alert</div>
              <div className="text-sm text-foreground">{topAlert}</div>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <TrendingUp className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
            <div>
              <div className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-0.5">Top Opportunity</div>
              <div className="text-sm text-foreground">{topOpportunity}</div>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
            <ShieldAlert className="w-4 h-4 text-yellow-400 mt-0.5 shrink-0" />
            <div>
              <div className="text-xs font-bold text-yellow-400 uppercase tracking-wider mb-0.5">Top Risk</div>
              <div className="text-sm text-foreground">{topRisk}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-background/50">
        <button
          onClick={() => setShowBreakdown(!showBreakdown)}
          className="w-full flex items-center justify-between p-3 text-xs font-medium text-muted-foreground hover:bg-muted/10 transition-colors"
        >
          <span>View Score Breakdown {failures && failures.length > 0 && <span className="text-red-400 ml-2">({failures.length} engines degraded)</span>}</span>
          {showBreakdown ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {showBreakdown && (
          <div className="p-4 border-t border-border/20 space-y-3 max-h-[300px] overflow-y-auto">
            {failures && failures.length > 0 && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-400">
                <div className="font-bold mb-1">Engine Failures:</div>
                <ul className="list-disc pl-4 space-y-1">
                  {failures.map((f, i) => <li key={i}>{f}</li>)}
                </ul>
              </div>
            )}
            
            {scoreBreakdown.map((item, i) => (
              <div key={i} className="flex flex-col gap-1 text-sm border-b border-border/10 pb-2 last:border-0 last:pb-0">
                <div className="flex justify-between items-center">
                  <span className="font-medium text-foreground">{item.label}</span>
                  <span className={`font-mono text-xs px-1.5 py-0.5 rounded ${
                    item.points > 0 ? "bg-emerald-500/10 text-emerald-400" : 
                    item.points < 0 ? "bg-red-500/10 text-red-400" : 
                    "bg-muted text-muted-foreground"
                  }`}>
                    {item.points > 0 ? "+" : ""}{item.points}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">{item.reason}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
