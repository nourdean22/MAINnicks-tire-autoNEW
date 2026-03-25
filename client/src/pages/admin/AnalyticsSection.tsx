/**
 * Analytics & Attribution Section — source attribution, conversion funnel, traffic sources.
 */
import { trpc } from "@/lib/trpc";
import { StatCard, CHART_COLORS } from "./shared";
import { BarChart3, TrendingUp, Users, Phone, Loader2, ArrowRight } from "lucide-react";

function SourceTable({ title, data }: { title: string; data: { source: string; count: number }[] }) {
  const total = data.reduce((s, d) => s + d.count, 0);
  if (!data.length) return (
    <div className="border border-border/30 rounded-lg p-6">
      <h4 className="text-sm font-semibold text-foreground mb-3">{title}</h4>
      <p className="text-xs text-muted-foreground">No data yet. UTM tracking is active — data will appear as visitors arrive from tagged campaigns.</p>
    </div>
  );
  return (
    <div className="border border-border/30 rounded-lg p-6">
      <h4 className="text-sm font-semibold text-foreground mb-4">{title}</h4>
      <div className="space-y-3">
        {data.map((d, i) => {
          const pct = total > 0 ? Math.round((d.count / total) * 100) : 0;
          return (
            <div key={d.source}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-foreground/80 capitalize">{d.source}</span>
                <span className="text-xs text-muted-foreground">{d.count} ({pct}%)</span>
              </div>
              <div className="h-2 bg-foreground/5 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${pct}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function AnalyticsSection() {
  const { data: stats, isLoading: statsLoading } = trpc.adminDashboard.stats.useQuery();
  const { data: funnel, isLoading: funnelLoading } = trpc.analytics.funnel.useQuery();
  const { data: serviceBreakdown } = trpc.analytics.serviceBreakdown.useQuery();

  if (statsLoading || funnelLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  const attribution = stats?.sourceAttribution;
  const calls = stats?.callTracking;
  const callbacks = stats?.callbacks;

  // Conversion funnel
  const funnelSteps = [
    { label: "Total Leads", value: funnel?.leads ?? 0, color: "text-blue-400" },
    { label: "Converted to Booking", value: funnel?.converted ?? 0, color: "text-amber-400" },
    { label: "Bookings Created", value: funnel?.bookings ?? 0, color: "text-primary" },
    { label: "Completed", value: funnel?.completed ?? 0, color: "text-emerald-400" },
  ];

  const conversionRate = (funnel?.leads ?? 0) > 0
    ? Math.round(((funnel?.converted ?? 0) / (funnel?.leads ?? 1)) * 100)
    : 0;

  const completionRate = (funnel?.bookings ?? 0) > 0
    ? Math.round(((funnel?.completed ?? 0) / (funnel?.bookings ?? 1)) * 100)
    : 0;

  return (
    <div className="space-y-8">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Lead → Booking Rate"
          value={`${conversionRate}%`}
          icon={<TrendingUp className="w-4 h-4" />}
          color={conversionRate > 30 ? "text-emerald-400" : conversionRate > 15 ? "text-amber-400" : "text-red-400"}
        />
        <StatCard
          label="Booking Completion"
          value={`${completionRate}%`}
          icon={<BarChart3 className="w-4 h-4" />}
          color={completionRate > 70 ? "text-emerald-400" : "text-amber-400"}
        />
        <StatCard
          label="Phone Calls Tracked"
          value={calls?.totalCalls ?? 0}
          icon={<Phone className="w-4 h-4" />}
          trendLabel={`${calls?.thisWeek ?? 0} this week`}
          trend={(calls?.thisWeek ?? 0) > 0 ? "up" : "neutral"}
        />
        <StatCard
          label="Callback Requests"
          value={callbacks?.total ?? 0}
          icon={<Users className="w-4 h-4" />}
          trendLabel={`${callbacks?.new ?? 0} pending`}
          trend={(callbacks?.new ?? 0) > 0 ? "up" : "neutral"}
        />
      </div>

      {/* Conversion Funnel */}
      <div className="border border-border/30 rounded-lg p-6">
        <h3 className="text-sm font-semibold text-foreground mb-6">Conversion Funnel</h3>
        <div className="flex items-center justify-between gap-2">
          {funnelSteps.map((step, i) => (
            <div key={step.label} className="flex items-center gap-2 flex-1">
              <div className="flex-1 text-center">
                <div className={`text-2xl font-bold ${step.color}`}>{step.value}</div>
                <div className="text-[10px] text-muted-foreground mt-1 uppercase tracking-wide">{step.label}</div>
              </div>
              {i < funnelSteps.length - 1 && (
                <ArrowRight className="w-4 h-4 text-foreground/20 shrink-0" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Source Attribution */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-4">Source Attribution (UTM Tracking)</h3>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <SourceTable title="Bookings by Source" data={attribution?.bookingsBySource ?? []} />
          <SourceTable title="Leads by Source" data={attribution?.leadsBySource ?? []} />
          <SourceTable title="Calls by Source" data={attribution?.callsBySource ?? []} />
        </div>
      </div>

      {/* Service Breakdown */}
      {serviceBreakdown && serviceBreakdown.length > 0 && (
        <div className="border border-border/30 rounded-lg p-6">
          <h3 className="text-sm font-semibold text-foreground mb-4">Service Mix (All Time)</h3>
          <div className="space-y-3">
            {serviceBreakdown.map((s: { service: string; count: number }, i: number) => {
              const maxCount = serviceBreakdown[0]?.count ?? 1;
              const pct = Math.round((s.count / maxCount) * 100);
              return (
                <div key={s.service}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-foreground/80">{s.service}</span>
                    <span className="text-xs text-muted-foreground">{s.count}</span>
                  </div>
                  <div className="h-2 bg-foreground/5 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* UTM Setup Guide */}
      <div className="border border-border/30 rounded-lg p-6 bg-primary/5">
        <h3 className="text-sm font-semibold text-foreground mb-2">UTM Tracking Setup</h3>
        <p className="text-xs text-muted-foreground leading-relaxed mb-3">
          Add UTM parameters to your ad links and social posts to track which channels drive the most leads and bookings.
        </p>
        <div className="bg-foreground/5 rounded p-3 font-mono text-[11px] text-foreground/70 break-all">
          nickstire.org/?utm_source=facebook&utm_medium=cpc&utm_campaign=spring_brakes
        </div>
        <p className="text-[10px] text-muted-foreground mt-2">
          Supported parameters: utm_source, utm_medium, utm_campaign. Data appears here automatically once visitors arrive from tagged URLs.
        </p>
      </div>
    </div>
  );
}
