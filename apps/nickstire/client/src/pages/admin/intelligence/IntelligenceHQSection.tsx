import React, { useState } from "react";
import { Brain, ShieldAlert, Target, Zap, Activity } from "lucide-react";
import { TopMoneyMoves } from "../today/TopMoneyMoves";
import { TodaysMoneyRisks } from "../today/TodaysMoneyRisks";
import { NextBestActions } from "../today/NextBestActions";
import { trpc } from "@/lib/trpc";

export default function IntelligenceHQSection() {
  const [activeTab, setActiveTab] = useState<"battlefield" | "ledger">("battlefield");

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
          <p className="text-sm text-muted-foreground mt-1">
            Action-first command center. Zero passive analytics.
          </p>
        </div>
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

              {/* LIVE RADAR */}
              <div className="stat-card !p-5 border-dashed">
                <div className="flex items-center gap-2 mb-4">
                  <Activity className="w-5 h-5 text-purple-400" />
                  <h2 className="text-sm font-black text-purple-400 tracking-wide uppercase">Live Radar</h2>
                </div>
                <div className="flex items-center justify-center h-32 text-muted-foreground/50 border border-dashed border-border/40 rounded">
                  No immediate anomalies detected in the last hour.
                </div>
              </div>
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
