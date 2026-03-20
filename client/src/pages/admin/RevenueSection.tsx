/**
 * RevenueSection — Advanced Revenue Dashboard with KPIs, charts, and projections.
 * Part of the Admin Command Center.
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  DollarSign, TrendingUp, TrendingDown, BarChart3, Users, Target,
  Loader2, Calendar, ArrowUpRight, ArrowDownRight, Minus, PieChart,
  Zap, Star, Clock, Activity
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip,
  ResponsiveContainer, LineChart, Line, PieChart as RPieChart, Pie, Cell, Legend,
  AreaChart, Area, CartesianGrid,
} from "recharts";

const CHART_COLORS = ["#F5A623", "#3B82F6", "#10B981", "#EF4444", "#8B5CF6", "#EC4899"];

function formatCents(cents: number): string {
  return "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export default function RevenueSection() {
  const [period, setPeriod] = useState(30);
  const { data: stats, isLoading } = trpc.invoices.stats.useQuery({ days: period }, { refetchInterval: 60000 });
  const { data: topCustomers } = trpc.invoices.topCustomers.useQuery({ limit: 10 });
  const { data: kpi } = trpc.kpi.current.useQuery(undefined, { refetchInterval: 60000 });

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  const revenueChange = stats?.periodComparison?.change ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="font-heading font-bold text-xl text-foreground tracking-wider">REVENUE COMMAND CENTER</h2>
          <p className="font-mono text-xs text-foreground/40 mt-1">Real-time financial intelligence</p>
        </div>
        <div className="flex items-center gap-2">
          {[7, 30, 90].map(d => (
            <button
              key={d}
              onClick={() => setPeriod(d)}
              className={`px-3 py-1.5 font-mono text-xs tracking-wider ${period === d ? "bg-primary text-primary-foreground" : "bg-card border border-border/30 text-foreground/60 hover:text-foreground"}`}
            >
              {d}D
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard
          label="Total Revenue"
          value={formatCents(stats?.totalRevenue ?? 0)}
          icon={<DollarSign className="w-5 h-5" />}
          trend={revenueChange}
          trendLabel={`${revenueChange >= 0 ? "+" : ""}${revenueChange}% vs prev period`}
          color="text-primary"
        />
        <KPICard
          label="Avg Ticket"
          value={formatCents(stats?.avgTicket ?? 0)}
          icon={<Target className="w-5 h-5" />}
          color="text-blue-400"
        />
        <KPICard
          label="Invoices"
          value={stats?.invoiceCount ?? 0}
          icon={<BarChart3 className="w-5 h-5" />}
          color="text-emerald-400"
        />
        <KPICard
          label="Conversion Rate"
          value={`${kpi?.conversionRate ?? 0}%`}
          icon={<Zap className="w-5 h-5" />}
          trendLabel="Leads → Bookings"
          color="text-purple-400"
        />
      </div>

      {/* Live Operations KPIs */}
      {kpi && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <MiniKPI label="This Week" value={kpi.weekBookings} sub="bookings" />
          <MiniKPI label="This Month" value={kpi.monthBookings} sub="bookings" />
          <MiniKPI label="Completed (Week)" value={kpi.completedThisWeek} sub="jobs" />
          <MiniKPI label="New Customers" value={kpi.newCustomersThisMonth} sub="this month" />
          <MiniKPI label="Emergency" value={kpi.emergencyThisWeek} sub="this week" alert={kpi.emergencyThisWeek > 0} />
        </div>
      )}

      {/* Revenue Chart */}
      {stats?.revenueByDay && stats.revenueByDay.length > 0 && (
        <div className="bg-card border border-border/30 p-5">
          <h3 className="font-heading font-bold text-sm text-foreground tracking-wider mb-4">REVENUE TREND</h3>
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.revenueByDay.map(d => ({ ...d, amount: d.amount / 100 }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#666" }} tickFormatter={(v) => v.slice(5)} />
                <YAxis tick={{ fontSize: 10, fill: "#666" }} tickFormatter={(v) => `$${v.toLocaleString()}`} />
                <RechartsTooltip
                  contentStyle={{ background: "#1a1a1a", border: "1px solid #333", fontSize: 12 }}
                  formatter={(value: number) => [`$${value.toLocaleString()}`, "Revenue"]}
                />
                <Area type="monotone" dataKey="amount" stroke="#F5A623" fill="#F5A623" fillOpacity={0.15} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Payment Method Breakdown */}
        {stats?.revenueByPayment && stats.revenueByPayment.length > 0 && (
          <div className="bg-card border border-border/30 p-5">
            <h3 className="font-heading font-bold text-sm text-foreground tracking-wider mb-4">PAYMENT METHODS</h3>
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <RPieChart>
                  <Pie
                    data={stats.revenueByPayment.map(d => ({ ...d, amount: d.amount / 100, name: d.method.toUpperCase() }))}
                    dataKey="amount"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  >
                    {stats.revenueByPayment.map((_, i) => (
                      <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    contentStyle={{ background: "#1a1a1a", border: "1px solid #333", fontSize: 12 }}
                    formatter={(value: number) => [`$${value.toLocaleString()}`, "Revenue"]}
                  />
                </RPieChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Booking Heatmap (Day of Week) */}
        {kpi?.dayOfWeekCounts && (
          <div className="bg-card border border-border/30 p-5">
            <h3 className="font-heading font-bold text-sm text-foreground tracking-wider mb-4">BOOKING HEATMAP — DAY OF WEEK</h3>
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, i) => ({
                  day,
                  count: kpi.dayOfWeekCounts[i],
                }))}>
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#888" }} />
                  <YAxis tick={{ fontSize: 10, fill: "#666" }} />
                  <RechartsTooltip contentStyle={{ background: "#1a1a1a", border: "1px solid #333", fontSize: 12 }} />
                  <Bar dataKey="count" fill="#F5A623" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* Top Customers */}
      {topCustomers && topCustomers.length > 0 && (
        <div className="bg-card border border-border/30 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-heading font-bold text-sm text-foreground tracking-wider">TOP CUSTOMERS BY REVENUE</h3>
            <span className="font-mono text-[10px] text-foreground/30">Lifetime value</span>
          </div>
          <div className="space-y-2">
            {topCustomers.map((c: any, i: number) => (
              <div key={i} className="flex items-center gap-4 py-2 border-b border-border/10 last:border-0">
                <span className="font-heading font-bold text-lg text-foreground/20 w-8">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <span className="font-heading font-bold text-sm text-foreground">{c.name}</span>
                  {c.phone && <span className="font-mono text-[10px] text-foreground/30 ml-2">{c.phone}</span>}
                </div>
                <div className="text-right">
                  <span className="font-heading font-bold text-sm text-primary">{formatCents(c.total)}</span>
                  <span className="font-mono text-[10px] text-foreground/30 block">{c.count} visits</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {(!stats?.revenueByDay || stats.revenueByDay.length === 0) && (
        <div className="bg-card border border-border/30 p-12 text-center">
          <DollarSign className="w-10 h-10 mx-auto mb-3 text-foreground/20" />
          <h3 className="font-heading font-bold text-foreground tracking-wider mb-2">NO REVENUE DATA YET</h3>
          <p className="font-mono text-xs text-foreground/40 max-w-md mx-auto">
            Revenue data populates when invoices are created — either manually, from ShopDriver imports, or from Stripe payments.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── KPI CARD ───────────────────────────────────────────
function KPICard({ label, value, icon, trend, trendLabel, color = "text-foreground" }: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: number;
  trendLabel?: string;
  color?: string;
}) {
  return (
    <div className="bg-card border border-border/30 p-5">
      <div className="flex items-start justify-between mb-3">
        <span className="font-mono text-[10px] text-foreground/50 tracking-wider uppercase">{label}</span>
        <div className="text-foreground/30">{icon}</div>
      </div>
      <div className={`font-heading font-bold text-3xl tracking-tight ${color}`}>{value}</div>
      {trendLabel && (
        <div className={`mt-2 flex items-center gap-1 font-mono text-[10px] tracking-wider ${
          trend !== undefined ? (trend > 0 ? "text-emerald-400" : trend < 0 ? "text-red-400" : "text-foreground/40") : "text-foreground/40"
        }`}>
          {trend !== undefined && trend > 0 && <ArrowUpRight className="w-3 h-3" />}
          {trend !== undefined && trend < 0 && <ArrowDownRight className="w-3 h-3" />}
          {trend !== undefined && trend === 0 && <Minus className="w-3 h-3" />}
          {trendLabel}
        </div>
      )}
    </div>
  );
}

// ─── MINI KPI ───────────────────────────────────────────
function MiniKPI({ label, value, sub, alert = false }: { label: string; value: number; sub: string; alert?: boolean }) {
  return (
    <div className={`bg-card border p-3 ${alert ? "border-red-500/30" : "border-border/30"}`}>
      <span className="font-mono text-[9px] text-foreground/40 tracking-wider uppercase block">{label}</span>
      <span className={`font-heading font-bold text-2xl ${alert ? "text-red-400" : "text-foreground"}`}>{value}</span>
      <span className="font-mono text-[9px] text-foreground/30 ml-1">{sub}</span>
    </div>
  );
}
