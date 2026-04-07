/**
 * IntelligenceSection — Unified view of ALL 11 intelligence engines.
 * Revenue Forecast, Customer Intelligence, Lead Scoring + Attribution, Data Intelligence.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { StatCard } from "./shared";
import {
  Brain, TrendingUp, TrendingDown, Minus, Users, Target, Phone,
  Loader2, BarChart3, Zap, AlertTriangle, MapPin, Clock, Car,
  MessageSquare, PhoneCall, XCircle, RefreshCw, ArrowRight,
  DollarSign, Activity, Star, Layers,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";

const TOOLTIP_STYLE = {
  background: "oklch(0.12 0.005 260)",
  border: "1px solid oklch(0.20 0.005 260)",
  borderRadius: "6px",
  fontFamily: "'Roboto Mono', monospace",
  fontSize: 11,
  padding: "8px 12px",
};

type Tab = "forecast" | "customers" | "leads" | "data";

function fmt(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export default function IntelligenceSection() {
  const [tab, setTab] = useState<Tab>("forecast");

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "forecast", label: "REVENUE FORECAST", icon: <TrendingUp className="w-3.5 h-3.5" /> },
    { id: "customers", label: "CUSTOMER INTEL", icon: <Users className="w-3.5 h-3.5" /> },
    { id: "leads", label: "LEADS & ATTRIBUTION", icon: <Target className="w-3.5 h-3.5" /> },
    { id: "data", label: "DATA INTELLIGENCE", icon: <Layers className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-violet-500/20 flex items-center justify-center rounded-sm">
            <Brain className="w-4 h-4 text-violet-400" />
          </div>
          <div>
            <p className="text-[12px] text-foreground/40">11 engines. One view. Real-time intelligence.</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] tracking-wider transition-colors ${
                tab === t.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-card border border-border/30 text-foreground/60 hover:text-foreground"
              }`}
            >
              {t.icon}
              <span className="hidden md:inline">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {tab === "forecast" && <ForecastTab />}
      {tab === "customers" && <CustomersTab />}
      {tab === "leads" && <LeadsTab />}
      {tab === "data" && <DataTab />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TAB 1: REVENUE FORECAST
// ═══════════════════════════════════════════════════════════

function ForecastTab() {
  const { data, isLoading, error } = trpc.intelligence.forecast.useQuery(undefined, { refetchInterval: 120000 });

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorState message={error?.message || "Failed to load forecast"} />;

  const trendIcon = data.trend === "up" ? <TrendingUp className="w-4 h-4" /> : data.trend === "down" ? <TrendingDown className="w-4 h-4" /> : <Minus className="w-4 h-4" />;
  const trendColor = data.trend === "up" ? "text-emerald-400" : data.trend === "down" ? "text-red-400" : "text-foreground/50";

  const DOW_NAMES: Record<string, string> = { "1": "Sun", "2": "Mon", "3": "Tue", "4": "Wed", "5": "Thu", "6": "Fri", "7": "Sat" };
  const dowData = Object.entries(data.dowAverages || {}).map(([k, v]) => ({
    name: DOW_NAMES[k] || k,
    avg: v as number,
  }));

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="TODAY SO FAR"
          value={fmt(data.today.soFar)}
          icon={<DollarSign className="w-4 h-4" />}
          color={data.today.pct >= 80 ? "text-emerald-400" : data.today.pct >= 50 ? "text-amber-400" : "text-red-400"}
          trendLabel={`${data.today.pct}% of expected ${fmt(data.today.expected)}`}
          trend={data.today.pct >= 80 ? "up" : "down"}
        />
        <StatCard
          label="WEEK PROJECTION"
          value={fmt(data.week.projection)}
          icon={<BarChart3 className="w-4 h-4" />}
          trendLabel={`${fmt(data.week.soFar)} earned so far`}
          trend="neutral"
        />
        <StatCard
          label="MONTH PROJECTION"
          value={fmt(data.month.projection)}
          icon={<Target className="w-4 h-4" />}
          color={data.month.onPace ? "text-emerald-400" : "text-red-400"}
          trendLabel={data.month.onPace ? "On pace for $20K target" : `${fmt(Math.abs(data.month.gap))} behind target`}
          trend={data.month.onPace ? "up" : "down"}
        />
        <StatCard
          label="TREND"
          value={data.trend.toUpperCase()}
          icon={trendIcon}
          color={trendColor}
          trendLabel={data.weeklyTrend?.length >= 2 ? `Last 2 weeks: ${fmt(data.weeklyTrend[data.weeklyTrend.length - 2])} -> ${fmt(data.weeklyTrend[data.weeklyTrend.length - 1])}` : "Insufficient data"}
        />
      </div>

      {/* Today's progress bar */}
      <div className="bg-card border border-border/30 p-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-medium text-foreground/50 tracking-wide">TODAY'S REVENUE VS EXPECTED</span>
          <span className="text-[12px] font-mono text-foreground/70">{fmt(data.today.soFar)} / {fmt(data.today.expected)}</span>
        </div>
        <div className="w-full h-3 bg-background rounded-sm overflow-hidden">
          <div
            className={`h-full transition-all duration-700 rounded-sm ${data.today.pct >= 80 ? "bg-emerald-500" : data.today.pct >= 50 ? "bg-amber-500" : "bg-red-500"}`}
            style={{ width: `${Math.min(100, data.today.pct)}%` }}
          />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[10px] text-foreground/30">0%</span>
          <span className={`text-[10px] font-semibold ${data.today.pct >= 100 ? "text-emerald-400" : "text-foreground/50"}`}>{data.today.pct}%</span>
          <span className="text-[10px] text-foreground/30">100%</span>
        </div>
      </div>

      {/* Month target progress */}
      <div className="bg-card border border-border/30 p-5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-medium text-foreground/50 tracking-wide">MONTH VS $20K TARGET</span>
          <span className="text-[12px] font-mono text-foreground/70">{fmt(data.month.soFar)} / $20,000</span>
        </div>
        <div className="w-full h-3 bg-background rounded-sm overflow-hidden">
          <div
            className={`h-full transition-all duration-700 rounded-sm ${data.month.onPace ? "bg-emerald-500" : "bg-red-500"}`}
            style={{ width: `${Math.min(100, Math.round((data.month.soFar / 20000) * 100))}%` }}
          />
        </div>
      </div>

      {/* Day-of-week averages */}
      {dowData.length > 0 && (
        <div className="bg-card border border-border/30 p-5">
          <h3 className="text-[11px] font-medium text-foreground/50 tracking-wide mb-4">DAY-OF-WEEK REVENUE AVERAGES</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={dowData}>
              <XAxis dataKey="name" tick={{ fill: "oklch(0.55 0 0)", fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "oklch(0.55 0 0)", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${v}`} />
              <RechartsTooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [fmt(v), "Avg Revenue"]} />
              <Bar dataKey="avg" fill="#F5A623" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TAB 2: CUSTOMER INTELLIGENCE
// ═══════════════════════════════════════════════════════════

function CustomersTab() {
  const { data: ltv, isLoading: ltvLoading } = trpc.intelligence.ltv.useQuery(undefined, { refetchInterval: 300000 });
  const { data: crossSell, isLoading: csLoading } = trpc.intelligence.crossSell.useQuery(undefined, { refetchInterval: 300000 });

  if (ltvLoading || csLoading) return <Spinner />;

  return (
    <div className="space-y-6">
      {/* Segment breakdown */}
      {ltv?.segments && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="WHALES" value={ltv.segments.whales} icon={<Star className="w-4 h-4" />} color="text-violet-400" trendLabel="LTV score >= 70" />
          <StatCard label="REGULARS" value={ltv.segments.regulars} icon={<Users className="w-4 h-4" />} color="text-blue-400" trendLabel="LTV score 40-69" />
          <StatCard label="OCCASIONAL" value={ltv.segments.occasional} icon={<Activity className="w-4 h-4" />} color="text-amber-400" trendLabel="LTV score 15-39" />
          <StatCard label="ONE-TIMERS" value={ltv.segments.oneTimers} icon={<XCircle className="w-4 h-4" />} color="text-foreground/50" trendLabel="LTV score < 15" />
        </div>
      )}

      {/* Top 10 customers */}
      {ltv?.topCustomers && ltv.topCustomers.length > 0 && (
        <div className="bg-card border border-border/30 p-5">
          <h3 className="text-[11px] font-medium text-foreground/50 tracking-wide mb-4">TOP 10 CUSTOMERS BY LTV SCORE</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-foreground/40 border-b border-border/20">
                  <th className="text-left py-2 pr-3 font-medium">#</th>
                  <th className="text-left py-2 pr-3 font-medium">NAME</th>
                  <th className="text-left py-2 pr-3 font-medium">PHONE</th>
                  <th className="text-right py-2 pr-3 font-medium">LTV</th>
                  <th className="text-right py-2 pr-3 font-medium">TOTAL SPENT</th>
                  <th className="text-right py-2 pr-3 font-medium">AVG TICKET</th>
                  <th className="text-right py-2 pr-3 font-medium">LAST VISIT</th>
                  <th className="text-left py-2 font-medium">CHURN</th>
                </tr>
              </thead>
              <tbody>
                {ltv.topCustomers.slice(0, 10).map((c: any, i: number) => (
                  <tr key={c.id} className="border-b border-border/10 hover:bg-foreground/[0.02] transition-colors">
                    <td className="py-2.5 pr-3 text-foreground/30 font-mono">{i + 1}</td>
                    <td className="py-2.5 pr-3 text-foreground font-medium">{c.name || "Unknown"}</td>
                    <td className="py-2.5 pr-3 text-foreground/60 font-mono">{c.phone || "-"}</td>
                    <td className="py-2.5 pr-3 text-right">
                      <span className={`font-bold font-mono ${c.ltvScore >= 70 ? "text-violet-400" : c.ltvScore >= 40 ? "text-blue-400" : "text-foreground/60"}`}>
                        {c.ltvScore}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-right text-foreground/70 font-mono">{fmt(c.totalSpent)}</td>
                    <td className="py-2.5 pr-3 text-right text-foreground/70 font-mono">{fmt(c.avgTicket)}</td>
                    <td className="py-2.5 pr-3 text-right text-foreground/50">{c.daysSinceLastVisit}d ago</td>
                    <td className="py-2.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide ${
                        c.churnRisk === "high" ? "text-red-400 bg-red-500/10" : c.churnRisk === "medium" ? "text-amber-400 bg-amber-500/10" : "text-emerald-400 bg-emerald-500/10"
                      }`}>
                        {c.churnRisk.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* At-risk high-value */}
      {ltv?.atRiskHighValue && ltv.atRiskHighValue.length > 0 && (
        <div className="bg-card border border-red-500/20 p-5">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <h3 className="text-[11px] font-medium text-red-400 tracking-wide">AT-RISK HIGH-VALUE CUSTOMERS -- CALL NOW</h3>
          </div>
          <div className="space-y-2">
            {ltv.atRiskHighValue.map((c: any) => (
              <div key={c.id} className="flex items-center justify-between py-2 border-b border-border/10 last:border-0">
                <div className="flex items-center gap-3">
                  <Phone className="w-3.5 h-3.5 text-red-400" />
                  <span className="text-foreground font-medium text-[13px]">{c.name || "Unknown"}</span>
                  <span className="text-foreground/40 font-mono text-[12px]">{c.phone}</span>
                </div>
                <div className="flex items-center gap-4 text-[12px]">
                  <span className="text-foreground/50">LTV {c.ltvScore}</span>
                  <span className="text-foreground/50">{fmt(c.totalSpent)} spent</span>
                  <span className="text-red-400 font-semibold">{c.daysSinceLastVisit}d since last visit</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cross-sell patterns */}
      {crossSell?.patterns && crossSell.patterns.length > 0 && (
        <div className="bg-card border border-border/30 p-5">
          <h3 className="text-[11px] font-medium text-foreground/50 tracking-wide mb-4">SERVICE CROSS-SELL PATTERNS (TOP 5)</h3>
          <div className="space-y-2">
            {crossSell.patterns.slice(0, 5).map((p: any, i: number) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-border/10 last:border-0">
                <div className="flex items-center gap-2 text-[13px]">
                  <span className="text-primary font-semibold capitalize">{p.from}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-foreground/30" />
                  <span className="text-foreground font-medium capitalize">{p.to}</span>
                </div>
                <div className="flex items-center gap-4 text-[12px] text-foreground/50">
                  <span>avg {p.avgDays} days</span>
                  <span className="font-mono">{p.count} occurrences</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cross-sell recommendations */}
      {crossSell?.recommendations && crossSell.recommendations.length > 0 && (
        <div className="bg-card border border-border/30 p-5">
          <h3 className="text-[11px] font-medium text-foreground/50 tracking-wide mb-4">CROSS-SELL RECOMMENDATIONS</h3>
          <div className="space-y-2">
            {crossSell.recommendations.slice(0, 10).map((r: any, i: number) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-border/10 last:border-0">
                <div className="flex items-center gap-3">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide ${
                    r.urgency === "overdue" ? "text-red-400 bg-red-500/10" : "text-amber-400 bg-amber-500/10"
                  }`}>
                    {r.urgency === "overdue" ? "OVERDUE" : "UPCOMING"}
                  </span>
                  <span className="text-foreground font-medium text-[13px]">{r.name || "Unknown"}</span>
                </div>
                <div className="text-[12px] text-foreground/50 text-right max-w-sm truncate">
                  <span className="capitalize font-medium text-primary">{r.service}</span> -- {r.reason}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TAB 3: LEAD SCORING + ATTRIBUTION
// ═══════════════════════════════════════════════════════════

function LeadsTab() {
  const { data: attribution, isLoading: attrLoading } = trpc.intelligence.attribution.useQuery(undefined, { refetchInterval: 300000 });
  const scoreLeads = trpc.intelligence.scoreLeads.useMutation({
    onSuccess: (d) => toast.success(`Re-scored ${d.count} leads`),
    onError: (e) => toast.error(e.message),
  });

  if (attrLoading) return <Spinner />;

  return (
    <div className="space-y-6">
      {/* Re-score button */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[13px] font-medium text-foreground tracking-wide">DYNAMIC LEAD SCORING</h3>
          <p className="text-[11px] text-foreground/40 mt-0.5">Multi-factor scoring: service value, source quality, existing customer, fleet, urgency, freshness</p>
        </div>
        <button
          onClick={() => scoreLeads.mutate()}
          disabled={scoreLeads.isPending}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 text-[12px] font-bold tracking-wide hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {scoreLeads.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
          RE-SCORE LEADS
        </button>
      </div>

      {/* Scored leads table */}
      {scoreLeads.data?.topLeads && scoreLeads.data.topLeads.length > 0 && (
        <div className="bg-card border border-border/30 p-5">
          <h3 className="text-[11px] font-medium text-foreground/50 tracking-wide mb-4">TOP LEADS BY SCORE</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-foreground/40 border-b border-border/20">
                  <th className="text-left py-2 pr-3 font-medium">SCORE</th>
                  <th className="text-left py-2 pr-3 font-medium">NAME</th>
                  <th className="text-left py-2 pr-3 font-medium">PHONE</th>
                  <th className="text-left py-2 pr-3 font-medium">FACTORS</th>
                  <th className="text-left py-2 font-medium">VEHICLE</th>
                </tr>
              </thead>
              <tbody>
                {scoreLeads.data.topLeads.map((l: any) => (
                  <tr key={l.id} className="border-b border-border/10 hover:bg-foreground/[0.02] transition-colors">
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-2 bg-background rounded-sm overflow-hidden">
                          <div
                            className={`h-full rounded-sm ${l.score >= 70 ? "bg-emerald-500" : l.score >= 40 ? "bg-amber-500" : "bg-foreground/30"}`}
                            style={{ width: `${l.score}%` }}
                          />
                        </div>
                        <span className="font-mono font-bold text-foreground/80">{l.score}</span>
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-foreground font-medium">{l.name || "Unknown"}</td>
                    <td className="py-2.5 pr-3 text-foreground/60 font-mono">{l.phone || "-"}</td>
                    <td className="py-2.5 pr-3 text-foreground/40 text-[10px]">{(l.factors || []).join(", ")}</td>
                    <td className="py-2.5 text-foreground/50">{l.vehicle || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Attribution KPIs */}
      {attribution && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="REVIEWS SENT"
              value={attribution.reviewAttribution.sent}
              icon={<Star className="w-4 h-4" />}
              trendLabel={`${attribution.reviewAttribution.clicked} clicked`}
            />
            <StatCard
              label="BOOKED AFTER REVIEW"
              value={attribution.reviewAttribution.bookedAfter}
              icon={<Zap className="w-4 h-4" />}
              color="text-emerald-400"
              trendLabel="Within 30 days"
            />
            <StatCard
              label="SMS CAMPAIGNS SENT"
              value={attribution.smsAttribution.sent}
              icon={<MessageSquare className="w-4 h-4" />}
              trendLabel={`${attribution.smsAttribution.bookedAfter} booked after`}
            />
            <StatCard
              label="SMS REVENUE"
              value={fmt(attribution.smsAttribution.revenueAfter)}
              icon={<DollarSign className="w-4 h-4" />}
              color="text-emerald-400"
              trendLabel="Attributed within 14 days"
            />
          </div>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// TAB 4: DATA INTELLIGENCE
// ═══════════════════════════════════════════════════════════

function DataTab() {
  const { data: chatDemand, isLoading: l1 } = trpc.intelligence.chatDemand.useQuery(undefined, { refetchInterval: 300000 });
  const { data: callAttr, isLoading: l2 } = trpc.intelligence.callAttribution.useQuery(undefined, { refetchInterval: 300000 });
  const { data: fleet, isLoading: l3 } = trpc.intelligence.fleet.useQuery(undefined, { refetchInterval: 300000 });
  const { data: geo, isLoading: l4 } = trpc.intelligence.geography.useQuery(undefined, { refetchInterval: 300000 });
  const { data: bottlenecks, isLoading: l5 } = trpc.intelligence.bottlenecks.useQuery(undefined, { refetchInterval: 300000 });
  const { data: declined, isLoading: l6 } = trpc.intelligence.declinedWork.useQuery(undefined, { refetchInterval: 300000 });

  if (l1 || l2 || l3 || l4 || l5 || l6) return <Spinner />;

  return (
    <div className="space-y-6">
      {/* Row 1: Chat Demand + Call Attribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Chat Demand */}
        {chatDemand && (
          <div className="bg-card border border-border/30 p-5">
            <div className="flex items-center gap-2 mb-4">
              <MessageSquare className="w-4 h-4 text-blue-400" />
              <h3 className="text-[11px] font-medium text-foreground/50 tracking-wide">CHAT DEMAND SIGNALS</h3>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="text-center">
                <div className="text-xl font-bold text-foreground">{chatDemand.totalSessions}</div>
                <div className="text-[10px] text-foreground/40">SESSIONS</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-emerald-400">{chatDemand.converted}</div>
                <div className="text-[10px] text-foreground/40">CONVERTED</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-primary">{chatDemand.conversionRate}%</div>
                <div className="text-[10px] text-foreground/40">CVR</div>
              </div>
            </div>
            {chatDemand.demandByService?.length > 0 && (
              <div className="space-y-1">
                {chatDemand.demandByService.slice(0, 6).map(([service, data]: any) => (
                  <div key={service} className="flex items-center justify-between py-1 text-[12px]">
                    <span className="text-foreground/70 capitalize">{service}</span>
                    <div className="flex items-center gap-3 text-foreground/50">
                      <span>{data.mentions} mentions</span>
                      <span className="text-emerald-400">{data.converted} converted</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Call Attribution */}
        {callAttr && (
          <div className="bg-card border border-border/30 p-5">
            <div className="flex items-center gap-2 mb-4">
              <PhoneCall className="w-4 h-4 text-emerald-400" />
              <h3 className="text-[11px] font-medium text-foreground/50 tracking-wide">CALL ATTRIBUTION</h3>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="text-center">
                <div className="text-xl font-bold text-foreground">{callAttr.totalCalls}</div>
                <div className="text-[10px] text-foreground/40">TOTAL CALLS</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-emerald-400">{callAttr.attributedToBookings}</div>
                <div className="text-[10px] text-foreground/40">BOOKED</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-primary">{callAttr.conversionRate}%</div>
                <div className="text-[10px] text-foreground/40">CVR</div>
              </div>
            </div>
            {callAttr.topPages?.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] text-foreground/40 mb-1">TOP PAGES DRIVING CALLS</div>
                {callAttr.topPages.slice(0, 5).map(([page, data]: any) => (
                  <div key={page} className="flex items-center justify-between py-1 text-[12px]">
                    <span className="text-foreground/70 truncate max-w-[200px]">{page}</span>
                    <div className="flex items-center gap-3 text-foreground/50">
                      <span>{data.calls} calls</span>
                      <span className="text-emerald-400">{data.bookings} booked</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Row 2: Fleet + Geography */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Fleet Intelligence */}
        {fleet && (
          <div className="bg-card border border-border/30 p-5">
            <div className="flex items-center gap-2 mb-4">
              <Car className="w-4 h-4 text-primary" />
              <h3 className="text-[11px] font-medium text-foreground/50 tracking-wide">FLEET INTELLIGENCE</h3>
              <span className="text-[10px] text-foreground/30 ml-auto">{fleet.totalVehicles} vehicles</span>
            </div>
            {fleet.topMakes?.length > 0 && (
              <div className="space-y-1">
                {fleet.topMakes.slice(0, 8).map(([make, data]: any) => (
                  <div key={make} className="flex items-center justify-between py-1 text-[12px]">
                    <span className="text-foreground/70 font-medium">{make}</span>
                    <div className="flex items-center gap-4 text-foreground/50">
                      <span>{data.count} vehicles</span>
                      <span className="font-mono">{fmt(data.revenue)}</span>
                      <span className="text-foreground/30">avg {fmt(data.avgSpend)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Geography */}
        {geo && (
          <div className="bg-card border border-border/30 p-5">
            <div className="flex items-center gap-2 mb-4">
              <MapPin className="w-4 h-4 text-amber-400" />
              <h3 className="text-[11px] font-medium text-foreground/50 tracking-wide">GEOGRAPHIC HOT ZONES</h3>
            </div>
            {geo.hotZones?.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="text-foreground/40 border-b border-border/20">
                      <th className="text-left py-1.5 pr-2 font-medium">ZIP</th>
                      <th className="text-left py-1.5 pr-2 font-medium">CITY</th>
                      <th className="text-right py-1.5 pr-2 font-medium">CUSTOMERS</th>
                      <th className="text-right py-1.5 font-medium">REVENUE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {geo.hotZones.slice(0, 8).map((z: any) => (
                      <tr key={z.zip} className="border-b border-border/10">
                        <td className="py-1.5 pr-2 text-foreground font-mono">{z.zip}</td>
                        <td className="py-1.5 pr-2 text-foreground/70">{z.city || "-"}</td>
                        <td className="py-1.5 pr-2 text-right text-foreground/60">{z.customers}</td>
                        <td className="py-1.5 text-right text-foreground/70 font-mono">{fmt(z.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Row 3: Bottlenecks + Declined Work */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Bottlenecks */}
        {bottlenecks && (
          <div className="bg-card border border-border/30 p-5">
            <div className="flex items-center gap-2 mb-4">
              <Clock className="w-4 h-4 text-amber-400" />
              <h3 className="text-[11px] font-medium text-foreground/50 tracking-wide">BOOKING BOTTLENECKS</h3>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="text-center">
                <div className="text-xl font-bold text-foreground">{bottlenecks.totalBookings}</div>
                <div className="text-[10px] text-foreground/40">BOOKINGS (30D)</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-emerald-400">{bottlenecks.completionRate}%</div>
                <div className="text-[10px] text-foreground/40">COMPLETION</div>
              </div>
            </div>
            {bottlenecks.bottleneck && (
              <div className="bg-amber-500/5 border border-amber-500/20 p-3 rounded-sm mb-3">
                <div className="text-[10px] text-amber-400 font-semibold tracking-wide mb-1">SLOWEST STAGE</div>
                <div className="flex items-center justify-between">
                  <span className="text-foreground font-medium text-[13px] capitalize">{bottlenecks.bottleneck.stage}</span>
                  <span className="text-amber-400 font-mono text-[13px]">{bottlenecks.bottleneck.avgHours}h avg</span>
                </div>
              </div>
            )}
            {bottlenecks.stageMetrics && (
              <div className="space-y-1">
                {Object.entries(bottlenecks.stageMetrics).sort((a: any, b: any) => b[1].avgHours - a[1].avgHours).map(([stage, data]: any) => (
                  <div key={stage} className="flex items-center justify-between py-1 text-[12px]">
                    <span className="text-foreground/70 capitalize">{stage}</span>
                    <div className="flex items-center gap-3 text-foreground/50">
                      <span>{data.count} bookings</span>
                      <span className="font-mono">{data.avgHours}h</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Declined Work */}
        {declined && (
          <div className="bg-card border border-border/30 p-5">
            <div className="flex items-center gap-2 mb-4">
              <XCircle className="w-4 h-4 text-red-400" />
              <h3 className="text-[11px] font-medium text-foreground/50 tracking-wide">DECLINED WORK ANALYSIS</h3>
            </div>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="text-center">
                <div className="text-xl font-bold text-foreground">{declined.totalWithDeclined}</div>
                <div className="text-[10px] text-foreground/40">WORK ORDERS</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-red-400">{fmt(declined.totalDeclinedValue)}</div>
                <div className="text-[10px] text-foreground/40">DECLINED $</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-emerald-400">{fmt(declined.recoveryOpportunity)}</div>
                <div className="text-[10px] text-foreground/40">RECOVERY OPP</div>
              </div>
            </div>
            {declined.topDeclinedServices?.length > 0 && (
              <div className="space-y-1">
                <div className="text-[10px] text-foreground/40 mb-1">MOST DECLINED SERVICES</div>
                {declined.topDeclinedServices.slice(0, 6).map(([service, data]: any) => (
                  <div key={service} className="flex items-center justify-between py-1 text-[12px]">
                    <span className="text-foreground/70 capitalize">{service}</span>
                    <div className="flex items-center gap-3 text-foreground/50">
                      <span>{data.count} times</span>
                      <span className="text-red-400 font-mono">{fmt(data.totalValue)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ═══════════════════════════════════════════════════════════

function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <Loader2 className="w-6 h-6 animate-spin text-primary" />
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <AlertTriangle className="w-8 h-8 text-red-400 mb-3" />
      <p className="text-foreground/60 text-sm">{message}</p>
    </div>
  );
}
