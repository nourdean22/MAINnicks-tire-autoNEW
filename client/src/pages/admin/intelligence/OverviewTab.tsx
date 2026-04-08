import { trpc } from "@/lib/trpc";
import { StatCard } from "../shared";
import { Spinner, NoData, STALE_TIME } from "./utils";
import {
  Activity, AlertTriangle, TrendingUp, Users, Star, Zap,
} from "lucide-react";

export default function OverviewTab() {
  const { data, isLoading, error } = trpc.intelligence.masterReport.useQuery(undefined, {
    staleTime: STALE_TIME,
  });

  if (isLoading) return <Spinner />;
  if (error || !data) return <NoData label="Master report unavailable" />;

  const score = data.summary.score ?? 0;
  const scoreColor = score >= 70 ? "text-emerald-400" : score >= 40 ? "text-amber-400" : "text-red-400";

  // Derived stats from sub-reports
  const revenuePace = data.revenue.pacing?.month?.soFar != null
    ? Math.round(((data.revenue.pacing.month.soFar) / 20000) * 100)
    : null;
  const churnCount = data.customers.churnRisk?.highRisk?.length ?? null;
  const reviewVel = data.marketing.reviewVelocity?.velocity ?? null;
  const newCusts = data.customers.velocity?.thisMonth ?? null;

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
