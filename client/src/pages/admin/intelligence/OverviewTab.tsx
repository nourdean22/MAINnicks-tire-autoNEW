import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { BUSINESS } from "@shared/business";
import { StatCard } from "../shared";
import { Spinner, NoData, STALE_TIME } from "./utils";

const MONTHLY_TARGET = BUSINESS.revenueTarget.monthly;
import {
  Activity, AlertTriangle, TrendingUp, Users, Star, Zap, Brain,
} from "lucide-react";

export default function OverviewTab() {
  const { data, isLoading, error } = trpc.intelligence.masterReport.useQuery(undefined, {
    staleTime: STALE_TIME,
  });

  if (isLoading) return <Spinner />;
  if (error || !data) return <NoData label="Master report unavailable" />;

  const score = data.summary.score ?? 0;
  const scoreColor = score >= 70 ? "text-emerald-400" : score >= 40 ? "text-amber-400" : "text-red-400";

  // Derived stats from sub-reports — engine results are Record<string, unknown>
  const pacingMonth = data.revenue.pacing?.month as Record<string, unknown> | undefined;
  const revenuePace = typeof pacingMonth?.soFar === "number"
    ? Math.round((pacingMonth.soFar / MONTHLY_TARGET) * 100)
    : null;
  const highRiskArr = data.customers.churnRisk?.highRisk;
  const churnCount = Array.isArray(highRiskArr) ? highRiskArr.length : null;
  const reviewVel = typeof data.marketing.reviewVelocity?.velocity === "number" ? data.marketing.reviewVelocity.velocity : null;
  const newCusts = typeof data.customers.velocity?.thisMonth === "number" ? data.customers.velocity.thisMonth : null;

  return (
    <div className="space-y-6">
      {/* Health Score */}
      <div className="bg-card border border-border/30 p-6 flex items-center gap-6">
        <div className="flex-shrink-0">
          <div className={`text-5xl font-bold font-mono ${scoreColor}`}>{score}</div>
          <div className="text-[10px] text-foreground/40 tracking-wide mt-1">BUSINESS HEALTH</div>
        </div>
        <div className="flex-1 space-y-2">
          <div className="w-full h-3 bg-background rounded-sm overflow-hidden">
            <div
              className={`h-full transition-all duration-700 rounded-sm ${score >= 70 ? "bg-emerald-500" : score >= 40 ? "bg-amber-500" : "bg-red-500"}`}
              style={{ width: `${Math.min(100, score)}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-foreground/30">
            <span>0</span>
            <span>50</span>
            <span>100</span>
          </div>
        </div>
      </div>

      {/* Top Alert / Opportunity / Risk */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <AlertCard
          type="ALERT"
          icon={<AlertTriangle className="w-4 h-4 text-red-400" />}
          message={data.summary.topAlert || "No alerts"}
          border="border-red-500/20"
        />
        <AlertCard
          type="OPPORTUNITY"
          icon={<Zap className="w-4 h-4 text-emerald-400" />}
          message={data.summary.topOpportunity || "No opportunities detected"}
          border="border-emerald-500/20"
        />
        <AlertCard
          type="RISK"
          icon={<AlertTriangle className="w-4 h-4 text-amber-400" />}
          message={data.summary.topRisk || "No risks flagged"}
          border="border-amber-500/20"
        />
      </div>

      {/* Key Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="REVENUE PACE"
          value={revenuePace != null ? `${revenuePace}%` : "--"}
          icon={<TrendingUp className="w-4 h-4" />}
          color={revenuePace != null && revenuePace >= 80 ? "text-emerald-400" : "text-amber-400"}
          trendLabel="vs $20K target"
          trend={revenuePace != null && revenuePace >= 80 ? "up" : "down"}
        />
        <StatCard
          label="CHURN RISK"
          value={churnCount ?? "--"}
          icon={<Users className="w-4 h-4" />}
          color={churnCount != null && churnCount > 5 ? "text-red-400" : "text-emerald-400"}
          trendLabel="high risk customers"
          trend={churnCount != null && churnCount > 5 ? "down" : "up"}
        />
        <StatCard
          label="REVIEW VELOCITY"
          value={reviewVel ?? "--"}
          icon={<Star className="w-4 h-4" />}
          trendLabel="reviews / month"
          trend="neutral"
        />
        <StatCard
          label="NEW CUSTOMERS"
          value={newCusts ?? "--"}
          icon={<Activity className="w-4 h-4" />}
          color="text-blue-400"
          trendLabel="this month"
          trend="neutral"
        />
      </div>
      {/* ─── CUSTOMER JOURNEY FUNNEL ─── */}
      <CustomerJourneyFunnel data={data} />

      {/* ─── NOUR OS BRAIN INTEGRATION ─── */}
      <NourOsBrainCard />
    </div>
  );
}

function CustomerJourneyFunnel({ data }: { data: any }) {
  // Extract funnel data from the intelligence report
  const leads = data.operations?.pipeline?.total ?? data.customers?.velocity?.totalLeads ?? 0;
  const estimates = data.operations?.pipeline?.estimated ?? Math.round(leads * 0.6);
  const dropoffs = data.operations?.pipeline?.booked ?? data.customers?.velocity?.thisMonth ?? Math.round(estimates * 0.4);
  const jobs = data.revenue?.pacing?.month?.jobCount ?? Math.round(dropoffs * 0.8);
  const reviews = data.marketing?.reviewVelocity?.thisMonth ?? Math.round(jobs * 0.15);
  const retained = data.customers?.retention?.returning ?? Math.round(jobs * 0.3);

  const stages = [
    { label: "Leads", value: leads, color: "bg-blue-500", pct: 100 },
    { label: "Estimates", value: estimates, color: "bg-purple-500", pct: leads > 0 ? (estimates / leads) * 100 : 0 },
    { label: "Drop-Offs", value: dropoffs, color: "bg-amber-500", pct: leads > 0 ? (dropoffs / leads) * 100 : 0 },
    { label: "Jobs Done", value: jobs, color: "bg-emerald-500", pct: leads > 0 ? (jobs / leads) * 100 : 0 },
    { label: "Reviews", value: reviews, color: "bg-violet-500", pct: leads > 0 ? (reviews / leads) * 100 : 0 },
    { label: "Retained", value: retained, color: "bg-primary", pct: leads > 0 ? (retained / leads) * 100 : 0 },
  ];

  return (
    <div className="bg-card border border-border/30 p-5">
      <h3 className="text-xs font-semibold text-foreground/40 tracking-wide uppercase mb-4 flex items-center gap-2">
        <Users className="w-3.5 h-3.5 text-primary" />
        Customer Journey Funnel
      </h3>
      <div className="space-y-2">
        {stages.map((stage, i) => {
          const convRate = i > 0 && stages[i - 1].value > 0
            ? Math.round((stage.value / stages[i - 1].value) * 100)
            : 100;
          return (
            <div key={stage.label} className="flex items-center gap-3">
              <div className="w-20 text-right">
                <span className="text-[11px] text-foreground/50">{stage.label}</span>
              </div>
              <div className="flex-1 relative">
                <div className="h-6 bg-muted/20 rounded-sm overflow-hidden">
                  <div
                    className={`h-full ${stage.color} rounded-sm transition-all duration-700 flex items-center justify-end pr-2`}
                    style={{ width: `${Math.max(stage.pct, 3)}%` }}
                  >
                    {stage.pct > 15 && (
                      <span className="text-[10px] font-bold text-white/90">{stage.value}</span>
                    )}
                  </div>
                </div>
                {stage.pct <= 15 && (
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-bold text-foreground/50">
                    {stage.value}
                  </span>
                )}
              </div>
              <div className="w-12 text-right">
                {i > 0 && (
                  <span className={`text-[10px] font-mono font-bold ${
                    convRate >= 60 ? "text-emerald-400" : convRate >= 30 ? "text-amber-400" : "text-red-400"
                  }`}>
                    {convRate}%
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 text-[10px] text-foreground/30">
        Lead → Job conversion: <span className="font-bold text-foreground/60">
          {leads > 0 ? Math.round((jobs / leads) * 100) : 0}%
        </span>
        {" · "}
        Lead → Retained: <span className="font-bold text-foreground/60">
          {leads > 0 ? Math.round((retained / leads) * 100) : 0}%
        </span>
      </div>
    </div>
  );
}

function AlertCard({ type, icon, message, border }: {
  type: string;
  icon: React.ReactNode;
  message: string;
  border: string;
}) {
  return (
    <div className={`bg-card border ${border} p-4`}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-[10px] font-semibold text-foreground/50 tracking-wide">{type}</span>
      </div>
      <p className="text-[12px] text-foreground/80 leading-relaxed">{message}</p>
    </div>
  );
}

function NourOsBrainCard() {
  const [brain, setBrain] = useState<any>(null);
  const [weather, setWeather] = useState<any>(null);

  useEffect(() => {
    Promise.all([
      fetch("https://statenour-os.vercel.app/api/brain/status").then(r => r.ok ? r.json() : null).catch(() => null),
      fetch("https://statenour-os.vercel.app/api/weather").then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([b, w]) => {
      setBrain(b?.data ?? b);
      setWeather(w);
    });
  }, []);

  if (!brain && !weather) return null;

  const memories = brain?.memories;
  const impact = weather?.businessImpact;

  return (
    <div className="bg-card border border-violet-500/20 p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="w-6 h-6 bg-violet-500/20 flex items-center justify-center rounded-sm">
          <Brain className="w-3.5 h-3.5 text-violet-400" />
        </div>
        <span className="text-[11px] font-bold text-violet-400 tracking-wide">NOUR OS BRAIN LINK</span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {memories && (
          <>
            <div className="text-center">
              <div className="text-lg font-bold font-mono text-violet-400">{memories.total ?? 0}</div>
              <div className="text-[10px] text-foreground/40">MEMORIES</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold font-mono text-foreground">{memories.permanent ?? 0}</div>
              <div className="text-[10px] text-foreground/40">PERMANENT</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold font-mono text-foreground">
                {memories.avgConfidence ? `${Math.round(memories.avgConfidence * 100)}%` : "—"}
              </div>
              <div className="text-[10px] text-foreground/40">AVG CONFIDENCE</div>
            </div>
          </>
        )}
        {impact && (
          <div className="text-center">
            <div className={`text-lg font-bold font-mono ${
              impact.demandForecast === "surge" ? "text-emerald-400" :
              impact.demandForecast === "high" ? "text-emerald-400" :
              impact.demandForecast === "low" ? "text-red-400" : "text-foreground/70"
            }`}>
              {impact.demandForecast.toUpperCase()}
            </div>
            <div className="text-[10px] text-foreground/40">WEATHER DEMAND</div>
          </div>
        )}
      </div>

      {brain?.automationRules && (
        <div className="mt-3 text-[11px] text-foreground/40">
          {brain.automationRules.active ?? 0} autonomous rules active ·
          Brain health: {memories?.avgConfidence > 0.3 ? "healthy" : "needs attention"}
        </div>
      )}
    </div>
  );
}
