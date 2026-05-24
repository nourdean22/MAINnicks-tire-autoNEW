import { trpc } from "@/lib/trpc";
import { StatCard } from "../shared";
import { SectionSpinner, NoData, EngineCard, MiniTable, Badge, fmt, INTELLIGENCE_QUERY_OPTS } from "./utils";
import {
  Users, AlertTriangle, Heart, Activity, Star, RefreshCw, UserCheck,
} from "lucide-react";

export default function CustomersTab() {
  const churn = trpc.intelligence.churnPrediction.useQuery(undefined, INTELLIGENCE_QUERY_OPTS);
  const risk = trpc.intelligence.riskScores.useQuery(undefined, INTELLIGENCE_QUERY_OPTS);
  const repeat = trpc.intelligence.repeatVisit.useQuery(undefined, INTELLIGENCE_QUERY_OPTS);
  const value = trpc.intelligence.valueTrend.useQuery(undefined, INTELLIGENCE_QUERY_OPTS);
  const affinity = trpc.intelligence.serviceAffinity.useQuery(undefined, INTELLIGENCE_QUERY_OPTS);
  const firstVisit = trpc.intelligence.firstVisitConversion.useQuery(undefined, INTELLIGENCE_QUERY_OPTS);
  // wave-181.x Intelligence Dispersal Wave 1 · `ltv` query removed
  // after both consuming panels (LTV Segments grid + TOP LTV
  // CUSTOMERS table) were deleted. The intelligence.ltv tRPC
  // procedure stays on the server (CustomersBrief consumes it
  // canonically).


  return (
    <div className="space-y-6">
      {/* wave-181.x Intelligence Dispersal Wave 1 · LTV Segments
       * grid (Whales/Regulars/Occasional/One-timers) deleted ·
       * duplicates the LTV roster CustomersBrief already surfaces
       * on the canonical Customers page. Per dispersal plan §4.1
       * Bucket A cuts. */}

      {/* Churn Prediction — highRisk: {name, phone, daysSinceVisit, churnProbability, reason}[] */}
      {churn.isLoading ? <SectionSpinner /> : churn.data ? (
        <EngineCard title="CHURN PREDICTION" icon={<AlertTriangle className="w-4 h-4 text-red-400" />}
          border={churn.data.highRisk?.length > 0 ? "border-red-500/20" : "border-border/30"}>
          {churn.data.highRisk?.length > 0 || churn.data.mediumRisk?.length > 0 ? (
            <>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="text-center">
                  <div className="text-xl font-bold text-red-400">{churn.data.highRisk?.length ?? 0}</div>
                  <div className="text-[10px] text-foreground/40">HIGH RISK</div>
                </div>
                <div className="text-center">
                  <div className="text-xl font-bold text-amber-400">{churn.data.mediumRisk?.length ?? 0}</div>
                  <div className="text-[10px] text-foreground/40">MEDIUM RISK</div>
                </div>
              </div>
              <MiniTable
                headers={["NAME", "RISK", "DAYS GONE", "REASON"]}
                rows={[...(churn.data.highRisk || []).slice(0, 5), ...(churn.data.mediumRisk || []).slice(0, 3)].map((c) => [
                  <span className="text-foreground font-medium">{c.name || "Unknown"}</span>,
                  <span className={`font-mono font-bold ${c.churnProbability >= 70 ? "text-red-400" : "text-amber-400"}`}>{c.churnProbability}%</span>,
                  <span className="font-mono">{c.daysSinceVisit}d</span>,
                  <span className="text-[10px] text-foreground/40 truncate max-w-[160px] block">{c.reason}</span>,
                ])}
              />
            </>
          ) : <NoData label="No churn risks detected" />}
        </EngineCard>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Risk Scores — highRisk: {name, phone, riskScore, factors}[] */}
        {risk.isLoading ? <SectionSpinner /> : risk.data ? (
          <EngineCard title="UNIFIED RISK SCORES" icon={<AlertTriangle className="w-4 h-4 text-amber-400" />}>
            {risk.data.highRisk?.length > 0 ? (
              <>
                <div className="text-[12px] text-foreground/50 mb-3">{risk.data.totalAtRisk} at risk of {risk.data.totalCustomers} total</div>
                <MiniTable
                  headers={["CUSTOMER", "SCORE", "FACTORS"]}
                  rows={risk.data.highRisk.slice(0, 8).map((c) => [
                    <span className="text-foreground font-medium">{c.name || "Unknown"}</span>,
                    <span className={`font-mono font-bold ${c.riskScore >= 70 ? "text-red-400" : c.riskScore >= 40 ? "text-amber-400" : "text-emerald-400"}`}>{c.riskScore}</span>,
                    <span className="text-[10px] text-foreground/40">{(c.factors || []).join(", ") || "-"}</span>,
                  ])}
                />
              </>
            ) : <NoData />}
          </EngineCard>
        ) : null}

        {/* Repeat Visit — dueSoon: {name, phone, predictedDate, avgGapDays, confidence}[] */}
        {repeat.isLoading ? <SectionSpinner /> : repeat.data ? (
          <EngineCard title="DUE-BACK PREDICTIONS" icon={<RefreshCw className="w-4 h-4 text-blue-400" />}>
            {repeat.data.dueSoon?.length > 0 ? (
              <>
                <div className="text-[12px] text-foreground/50 mb-3">{repeat.data.overdueCount} overdue</div>
                <MiniTable
                  headers={["CUSTOMER", "PREDICTED", "GAP", "CONFIDENCE"]}
                  rows={repeat.data.dueSoon.slice(0, 8).map((c) => [
                    <span className="text-foreground font-medium">{c.name || "Unknown"}</span>,
                    <span className="font-mono text-foreground/60">{c.predictedDate}</span>,
                    <span className="font-mono">{c.avgGapDays}d avg</span>,
                    <span className={`font-mono font-semibold ${c.confidence >= 70 ? "text-emerald-400" : "text-foreground/50"}`}>{c.confidence}%</span>,
                  ])}
                />
              </>
            ) : <NoData />}
          </EngineCard>
        ) : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Value Trend — growing/shrinking: {name, trend, lastTicket, avgTicket}[] */}
        {value.isLoading ? <SectionSpinner /> : value.data ? (
          <EngineCard title="CUSTOMER VALUE TREND" icon={<Activity className="w-4 h-4 text-emerald-400" />}>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="text-center">
                <div className="text-lg font-bold text-emerald-400">{value.data.growing?.length ?? 0}</div>
                <div className="text-[10px] text-foreground/40">GROWING</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-red-400">{value.data.shrinking?.length ?? 0}</div>
                <div className="text-[10px] text-foreground/40">SHRINKING</div>
              </div>
            </div>
            {value.data.growing?.length > 0 && (
              <div className="space-y-1">
                {value.data.growing.slice(0, 5).map((c, i) => (
                  <div key={i} className="flex items-center justify-between py-1 text-[12px]">
                    <span className="text-foreground/70 font-medium">{c.name || "Unknown"}</span>
                    <span className="font-mono text-emerald-400">+{c.trend}% trend</span>
                  </div>
                ))}
              </div>
            )}
          </EngineCard>
        ) : null}

        {/* Service Affinity — affinities: {customerId, name, topServices, predictedNext}[] */}
        {affinity.isLoading ? <SectionSpinner /> : affinity.data ? (
          <EngineCard title="SERVICE PREFERENCES" icon={<Heart className="w-4 h-4 text-primary" />}>
            {affinity.data.affinities?.length > 0 ? (
              <MiniTable
                headers={["CUSTOMER", "TOP SERVICES", "PREDICTED NEXT"]}
                rows={affinity.data.affinities.slice(0, 6).map((a) => [
                  <span className="text-foreground font-medium">{a.name}</span>,
                  <span className="text-[10px] text-foreground/50">{(a.topServices || []).join(", ")}</span>,
                  <span className="text-primary font-medium capitalize">{a.predictedNext}</span>,
                ])}
              />
            ) : <NoData />}
          </EngineCard>
        ) : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* First Visit Conversion — {overallRate, bySource, avgDaysToRepeat} */}
        {firstVisit.isLoading ? <SectionSpinner /> : firstVisit.data ? (
          <EngineCard title="FIRST VISIT CONVERSION" icon={<UserCheck className="w-4 h-4 text-emerald-400" />}>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="text-center">
                <div className="text-xl font-bold text-primary font-mono">{firstVisit.data.overallRate}%</div>
                <div className="text-[10px] text-foreground/40">CONVERSION RATE</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-foreground font-mono">{firstVisit.data.avgDaysToRepeat}d</div>
                <div className="text-[10px] text-foreground/40">AVG DAYS TO REPEAT</div>
              </div>
            </div>
            {firstVisit.data.bySource?.length > 0 && (
              <MiniTable
                headers={["SOURCE", "FIRST", "REPEATED", "RATE"]}
                rows={firstVisit.data.bySource.slice(0, 5).map((s) => [
                  <span className="text-foreground capitalize font-medium">{s.source}</span>,
                  <span className="font-mono">{s.firstVisits}</span>,
                  <span className="font-mono text-emerald-400">{s.repeated}</span>,
                  <span className="font-mono font-semibold">{s.rate}%</span>,
                ])}
              />
            )}
          </EngineCard>
        ) : null}

        {/* wave-181.x Intelligence Dispersal Wave 1 · TOP LTV
         * CUSTOMERS table deleted · same data lives on the CustomersBrief
         * + CustomersSection roster (canonical home for LTV signal).
         * Per dispersal plan §4.1 Bucket A cuts. */}
      </div>
    </div>
  );
}
