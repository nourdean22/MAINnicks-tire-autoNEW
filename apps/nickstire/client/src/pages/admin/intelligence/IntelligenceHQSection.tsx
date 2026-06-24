import React, { useState } from "react";
import { Brain, ShieldAlert, Target, Zap, Activity } from "lucide-react";
import { TopMoneyMoves } from "../today/TopMoneyMoves";
import { TodaysMoneyRisks } from "../today/TodaysMoneyRisks";
import { NextBestActions } from "../today/NextBestActions";
import { AIHealthPanel } from "./AIHealthPanel";
import { CustomerIntelligence } from "./CustomerIntelligence";
import { LeadSLAMonitor } from "./LeadSLAMonitor";
import { MarketIntelligence } from "./MarketIntelligence";
import { trpc } from "@/lib/trpc";
import { useQueryClient } from "@tanstack/react-query";

export default function IntelligenceHQSection() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"battlefield" | "ledger">("battlefield");

  const { data: report, isFetching } = trpc.intelligence.masterReport.useQuery(undefined, {
    refetchInterval: 60000,
  });

  // Calculate status
  const status = !report ? "degraded" : report.summary.failures?.length > 0 ? "partial" : "live";
  const mainFight = report?.summary?.topAlert || "clear stale callbacks before they turn into lost money.";

  // Fetch the recent intelligence decisions from the ledger
  const { data: recentDecisions } = trpc.intelligence.recentDecisions.useQuery(undefined, {
    refetchInterval: 30000,
  });

  return (
    <div className="admin-section animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* ─── COMMAND HEADER ─── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-8 gap-4 px-4 pt-4">
        <div>
          <h1 className="text-2xl font-black text-foreground tracking-tight flex items-center gap-3">
            <div className="p-2 bg-purple-500/10 text-purple-400 rounded-lg">
              <Brain className="w-6 h-6" />
            </div>
            Intelligence HQ
          </h1>
          <div className="flex items-center gap-3 mt-1 text-sm">
            <p className="text-muted-foreground">Action-first command center. Zero passive analytics.</p>
            <span className="text-border/50">•</span>
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                  status === "live" ? "bg-emerald-400" : status === "partial" ? "bg-yellow-400" : "bg-red-400"
                }`}></span>
                <span className={`relative inline-flex rounded-full h-2 w-2 ${
                  status === "live" ? "bg-emerald-500" : status === "partial" ? "bg-yellow-500" : "bg-red-500"
                }`}></span>
              </span>
              <span className={`font-mono text-xs uppercase ${
                status === "live" ? "text-emerald-400" : status === "partial" ? "text-yellow-400" : "text-red-400"
              }`}>
                System {status}
              </span>
            </div>
            {report?.timestamp && (
              <>
                <span className="text-border/50">•</span>
                <span className="text-xs text-muted-foreground">Updated {new Date(report.timestamp).toLocaleTimeString()}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => queryClient.invalidateQueries()}
            disabled={isFetching}
            className="p-1.5 rounded-md border border-border/40 hover:bg-muted/20 text-muted-foreground transition-colors disabled:opacity-50"
            title="Refresh Intelligence"
          >
            <Activity className={`w-4 h-4 ${isFetching ? "animate-spin text-primary" : ""}`} />
          </button>
          <div className="flex bg-background/50 border border-border/40 p-1 rounded-lg">
          <button
            onClick={() => setActiveTab("battlefield")}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
              activeTab === "battlefield"
                ? "bg-primary/10 text-primary shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Battlefield
          </button>
          <button
            onClick={() => setActiveTab("ledger")}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${
              activeTab === "ledger"
                ? "bg-primary/10 text-primary shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Decision Ledger
          </button>
        </div>
      </div>

      {activeTab === "battlefield" && (
        <div className="space-y-6 px-4">
          {/* ─── TODAY'S MAIN FIGHT ─── */}
          <div className="bg-primary/10 border border-primary/20 rounded-xl p-4 flex items-center gap-3">
            <Zap className="w-5 h-5 text-primary" />
            <div className="text-sm font-medium">
              <span className="text-primary font-bold">Today's main fight:</span> {mainFight}
            </div>
          </div>

          {/* ─── BATTLEFIELD OVERVIEW ─── */}
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-6">
              {/* TOP MONEY MOVES */}
              <div className="stat-card !p-5 !border-emerald-500/20 bg-emerald-500/5">
                <div className="flex items-center gap-2 mb-4">
                  <Target className="w-5 h-5 text-emerald-400" />
                  <h2 className="text-sm font-black text-emerald-400 tracking-wide uppercase">Top Money Moves</h2>
                </div>
                <TopMoneyMoves />
              </div>

              {/* NEXT BEST ACTIONS */}
              <div className="stat-card !p-5 !border-blue-500/20 bg-blue-500/5">
                <div className="flex items-center gap-2 mb-4">
                  <Zap className="w-5 h-5 text-blue-400" />
                  <h2 className="text-sm font-black text-blue-400 tracking-wide uppercase">Next Best Actions</h2>
                </div>
                <NextBestActions />
              </div>

              {/* CUSTOMER INTELLIGENCE */}
              <CustomerIntelligence />

              {/* LEAD SLA MONITOR */}
              <LeadSLAMonitor />
            </div>

            <div className="space-y-6">
              {/* MONEY RISKS */}
              <div className="stat-card !p-5 !border-red-500/20 bg-red-500/5">
                <div className="flex items-center gap-2 mb-4">
                  <ShieldAlert className="w-5 h-5 text-red-400" />
                  <h2 className="text-sm font-black text-red-400 tracking-wide uppercase">Money At Risk</h2>
                </div>
                <TodaysMoneyRisks />
              </div>

              {/* AI HEALTH PANEL */}
              <AIHealthPanel />

              {/* MARKET INTELLIGENCE */}
              <MarketIntelligence />
            </div>
          </div>
        </div>
      )}

      {activeTab === "ledger" && (
        <div className="px-4">
          <div className="stat-card !p-0 overflow-hidden">
            <div className="p-4 border-b border-border/20 bg-muted/20">
              <h3 className="text-sm font-bold text-foreground">Recent Decisions</h3>
              <p className="text-xs text-muted-foreground">Log of all AI recommendations taken by operators.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-background/50 text-xs uppercase text-muted-foreground/70">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Time</th>
                    <th className="px-4 py-3 font-semibold">Engine</th>
                    <th className="px-4 py-3 font-semibold">Recommendation</th>
                    <th className="px-4 py-3 font-semibold">Action Taken</th>
                    <th className="px-4 py-3 font-semibold">Value at Risk</th>
                    <th className="px-4 py-3 font-semibold">Actual Captured</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/10">
                  {recentDecisions?.map((d: any) => (
                    <tr key={d.id} className="hover:bg-muted/10 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                        {new Date(d.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 font-medium text-foreground">
                        {d.engineId}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{d.recommendationType}</div>
                        <div className="text-xs text-muted-foreground">{d.recommendationTarget}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary">
                          {d.actionTaken}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-red-400 font-mono">
                        {d.valueAtRiskCents ? `$${(d.valueAtRiskCents / 100).toFixed(2)}` : "-"}
                      </td>
                      <td className="px-4 py-3 text-emerald-400 font-mono">
                        {d.actualRevenueCapturedCents !== null ? `$${(d.actualRevenueCapturedCents / 100).toFixed(2)}` : "Pending"}
                      </td>
                    </tr>
                  ))}
                  {!recentDecisions?.length && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                        No decisions recorded yet. Take action on an intelligence recommendation to start building the ledger.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
