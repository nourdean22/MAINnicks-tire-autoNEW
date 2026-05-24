import { trpc } from "@/lib/trpc";
import { StatCard } from "../shared";
import { Spinner, NoData, INTELLIGENCE_QUERY_OPTS } from "./utils";
// wave-181.x Intelligence Dispersal Wave 1 · trimmed unused imports
// after deleting 3 StatCards + NourOsBrainCard (Activity · TrendingUp ·
// Brain · BUSINESS · MONTHLY_TARGET).
import { AlertTriangle, Users, Star, Zap } from "lucide-react";

export default function OverviewTab() {
  const { data, isLoading, error } = trpc.intelligence.masterReport.useQuery(undefined, INTELLIGENCE_QUERY_OPTS);

  if (isLoading) return <Spinner />;
  if (error || !data) return <NoData label="Master report unavailable" />;

  const score = data.summary.score ?? 0;
  const scoreColor = score >= 70 ? "text-emerald-400" : score >= 40 ? "text-amber-400" : "text-red-400";

  // wave-181.x Intelligence Dispersal Wave 1 · 3 derived stats deleted:
  //   · revenuePace · MoneyBrief already shows pacing on the Money page
  //   · churnCount · CustomersBrief surfaces the same adjacency
  //   · newCusts · LeadsBrief velocity covers this
  // Per 2026-05-24-intelligence-dispersal-plan.md §4.1 Bucket A cuts.
  // reviewVel stays — going to statenour /radar in a later wave.
  const reviewVel = typeof data.marketing.reviewVelocity?.velocity === "number" ? data.marketing.reviewVelocity.velocity : null;

  return (
    <div className="space-y-6">
      {/* Health Score + per-component breakdown.
          Shows EXACTLY which signals are pulling the score up vs. down so
          you know what to fix. Each row maps to one of the 13 components
          in masterIntelligence.ts. */}
      <div className="bg-card border border-border/30 p-6">
        <div className="flex items-center gap-6 mb-5">
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

        {/* Per-component breakdown — only renders if backend provided one */}
        {Array.isArray(data.summary.scoreBreakdown) && data.summary.scoreBreakdown.length > 0 && (
          <div className="border-t border-border/20 pt-4">
            <div className="text-[10px] font-bold text-foreground/40 tracking-wider uppercase mb-3">
              Score Breakdown — 13 signals
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5">
              {data.summary.scoreBreakdown.map((c, i) => (
                <ScoreComponentRow key={i} component={c} />
              ))}
            </div>
            <div className="mt-3 text-[10px] text-foreground/40 italic">
              Each component contributes ± points within its max range. Missing-data signals are skipped (no penalty).
            </div>
          </div>
        )}
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

      {/* wave-181.x Intelligence Dispersal Wave 1 · 3 of 4 stat cards
       * deleted (Revenue Pace · Churn Risk · New Customers) per
       * dispersal plan §4.1 — all duplicated by the page-specific
       * briefs (MoneyBrief · CustomersBrief · LeadsBrief). Only
       * Review Velocity remains (going to statenour /radar later). */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-w-md">
        <StatCard
          label="REVIEW VELOCITY"
          value={reviewVel ?? "--"}
          icon={<Star className="w-4 h-4" />}
          trendLabel="reviews / month"
          trend="neutral"
        />
      </div>
      {/* ─── CUSTOMER JOURNEY FUNNEL ─── */}
      <CustomerJourneyFunnel data={data} />

      {/* wave-181.x Intelligence Dispersal Wave 1 · NourOsBrainCard
       * deleted (~66 LOC) · it was a pure proxy of statenour brain
       * endpoints · duplicating data the operator can see on statenour
       * directly. Per dispersal plan §4.3 Bucket C "HIGH-confidence →
       * delete" list. */}
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

function ScoreComponentRow({ component: c }: { component: { label: string; points: number; maxPoints: number; reason: string; hasData: boolean } }) {
  const isPositive = c.points > 0;
  const isNegative = c.points < 0;
  const isSkipped = !c.hasData;
  const sign = c.points > 0 ? "+" : "";
  const color = isSkipped ? "text-foreground/30" : isPositive ? "text-emerald-400" : isNegative ? "text-red-400" : "text-foreground/50";

  return (
    <div className="flex items-start gap-3 py-1.5 group">
      <div className={`font-mono font-bold text-xs w-12 text-right shrink-0 ${color}`}>
        {isSkipped ? "—" : `${sign}${c.points}`}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-[12px] font-medium text-foreground/80">{c.label}</span>
          <span className="text-[9px] text-foreground/30 font-mono">±{c.maxPoints}</span>
        </div>
        <div className="text-[10px] text-foreground/40 leading-tight truncate group-hover:whitespace-normal">{c.reason}</div>
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

// wave-181.x Intelligence Dispersal Wave 1 · NourOsBrainCard function
// deleted (was 66 LOC at this location). The card was a pure proxy of
// statenour-side endpoints (autonicksBrainStatus + autonicksWeather)
// that duplicated brain memories + weather demand the operator can
// see on statenour directly. Per dispersal plan §4.3 "HIGH-confidence
// → delete" list. The tRPC procedures themselves stay (intelligence.
// autonicksBrainStatus + autonicksWeather) since other callers may
// use them — only this UI surface is removed.
