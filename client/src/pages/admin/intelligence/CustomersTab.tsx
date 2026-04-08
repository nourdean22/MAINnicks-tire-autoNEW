import { trpc } from "@/lib/trpc";
import { StatCard } from "../shared";
import { SectionSpinner, NoData, EngineCard, MiniTable, Badge, fmt, STALE_TIME } from "./utils";
import {
  Users, AlertTriangle, Heart, Activity, Star, RefreshCw, UserCheck,
} from "lucide-react";

export default function CustomersTab() {
  const churn = trpc.intelligence.churnPrediction.useQuery(undefined, { staleTime: STALE_TIME });
  const risk = trpc.intelligence.riskScores.useQuery(undefined, { staleTime: STALE_TIME });
  const repeat = trpc.intelligence.repeatVisit.useQuery(undefined, { staleTime: STALE_TIME });
  const value = trpc.intelligence.valueTrend.useQuery(undefined, { staleTime: STALE_TIME });
  const affinity = trpc.intelligence.serviceAffinity.useQuery(undefined, { staleTime: STALE_TIME });
  const firstVisit = trpc.intelligence.firstVisitConversion.useQuery(undefined, { staleTime: STALE_TIME });
  const ltv = trpc.intelligence.ltv.useQuery(undefined, { staleTime: STALE_TIME });

  return (
    <div className="space-y-6">
      {/* LTV Segments */}
      {ltv.isLoading ? <SectionSpinner /> : ltv.data?.segments ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="WHALES" value={ltv.data.segments.whales} icon={<Star className="w-4 h-4" />} color="text-violet-400" trendLabel="LTV >= 70" />
          <StatCard label="REGULARS" value={ltv.data.segments.regulars} icon={<Users className="w-4 h-4" />} color="text-blue-400" trendLabel="LTV 40-69" />
          <StatCard label="OCCASIONAL" value={ltv.data.segments.occasional} icon={<Activity className="w-4 h-4" />} color="text-amber-400" trendLabel="LTV 15-39" />
          <StatCard label="ONE-TIMERS" value={ltv.data.segments.oneTimers} icon={<UserCheck className="w-4 h-4" />} color="text-foreground/50" trendLabel="LTV < 15" />
        </div>
      ) : null}

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
                rows={[...(churn.data.highRisk || []).slice(0, 5), ...(churn.data.mediumRisk || []).slice(0, 3)].map((c: any) => [
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
                  rows={risk.data.highRisk.slice(0, 8).map((c: any) => [
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
                  rows={repeat.data.dueSoon.slice(0, 8).map((c: any) => [
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
                {value.data.growing.slice(0, 5).map((c: any, i: number) => (
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
          <EngineCard title="SERVICE PREFERENCES" icon={<Heart className="w-4 h-4 text-pink-400" />}>
            {affinity.data.affinities?.length > 0 ? (
              <MiniTable
                headers={["CUSTOMER", "TOP SERVICES", "PREDICTED NEXT"]}
                rows={affinity.data.affinities.slice(0, 6).map((a: any) => [
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
                rows={firstVisit.data.bySource.slice(0, 5).map((s: any) => [
                  <span className="text-foreground capitalize font-medium">{s.source}</span>,
                  <span className="font-mono">{s.firstVisits}</span>,
                  <span className="font-mono text-emerald-400">{s.repeated}</span>,
                  <span className="font-mono font-semibold">{s.rate}%</span>,
                ])}
              />
            )}
          </EngineCard>
        ) : null}

        {/* LTV Top Customers */}
        {ltv.isLoading ? <SectionSpinner /> : ltv.data && ltv.data.topCustomers?.length > 0 ? (
          <EngineCard title="TOP LTV CUSTOMERS" icon={<Star className="w-4 h-4 text-violet-400" />}>
            <MiniTable
              headers={["NAME", "LTV", "SPENT", "CHURN"]}
              rows={ltv.data.topCustomers.slice(0, 6).map((c: any) => [
                <span className="text-foreground font-medium">{c.name || "Unknown"}</span>,
                <span className={`font-mono font-bold ${c.ltvScore >= 70 ? "text-violet-400" : c.ltvScore >= 40 ? "text-blue-400" : "text-foreground/60"}`}>{c.ltvScore}</span>,
                <span className="font-mono">{fmt(c.totalSpent)}</span>,
                <Badge label={c.churnRisk?.toUpperCase() || "LOW"} level={c.churnRisk || "low"} />,
              ])}
            />
          </EngineCard>
        ) : null}
      </div>
    </div>
  );
}
