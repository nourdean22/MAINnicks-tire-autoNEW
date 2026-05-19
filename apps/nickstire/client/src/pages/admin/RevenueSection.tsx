/**
 * RevenueSection — Advanced Revenue Command Center with KPIs, charts, projections,
 * invoice management, create invoice form, and hour-of-day heatmap.
 * AUDIT-FIXED: Added create invoice, hour heatmap, invoice table with edit/delete.
 */
import React, { useState, useMemo, lazy, Suspense } from "react";
import { BUSINESS } from "@shared/business";

const MONTHLY_TARGET = BUSINESS.revenueTarget.monthly;
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  DollarSign, TrendingUp, TrendingDown, BarChart3, Users, Target,
  Loader2, Calendar, ArrowUpRight, ArrowDownRight, Minus, PieChart,
  Zap, Star, Clock, Activity, Plus, X, Trash2, Edit2, FileText, Search,
  ArrowRight, AlertTriangle, CheckCircle2, Wrench, CreditCard, Tag,
  MessageSquare, ArrowUp, ArrowDown, ChevronUp, ChevronDown,
  Car, Phone, Mail, ExternalLink, Hash,
} from "lucide-react";

// 2026-05-19 Elon-cut · Specials moved to ContentSection (it's content
// management, not invoice data). Financing tab killed — snapDashboard
// at the sidebar level is the canonical Snap Finance surface.
const WorkOrdersSection = lazy(() => import("./WorkOrdersSection"));
// wave-110 — CustomersSection removed; reachable as top-level /admin?tab=customers
const DispatchSection = lazy(() => import("./DispatchSection"));
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip,
  ResponsiveContainer, LineChart, Line, PieChart as RPieChart, Pie, Cell, Legend,
  AreaChart, Area, CartesianGrid,
} from "recharts";

import { CHART_COLORS, CHART_THEME, PageHeader, LoadingState, SectionInsightStrip, TabBar, useUrlFilter } from "./shared";
import { SkeletonKpiGrid, SkeletonChart } from "@/components/admin/AdminSkeletons";

function formatCents(cents: number): string {
  return "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatDollars(dollars: number): string {
  return "$" + dollars.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// 2026-05-19 Elon-cut · specials + financing tabs removed (see header).
type SectionTab = "revenue" | "shopPulse" | "shopStatus";

const REVENUE_TABS: { id: SectionTab; label: string; icon: React.ReactNode }[] = [
  { id: "revenue", label: "Revenue", icon: <DollarSign className="w-3.5 h-3.5" /> },
  { id: "shopPulse", label: "Shop Pulse", icon: <Wrench className="w-3.5 h-3.5" /> },
  { id: "shopStatus", label: "Shop Status", icon: <Activity className="w-3.5 h-3.5" /> },
];

export default function RevenueSection() {
  const [section, setSection] = useState<SectionTab>("revenue");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Revenue & Shop"
        subtitle="Daily flow · invoices · work orders · tier breakdown · forecasting · ALG mirror is the source of truth"
        icon={<TrendingUp className="w-5 h-5" />}
      />
      <SectionInsightStrip section="revenue" />
      <TabBar
        tabs={REVENUE_TABS}
        activeTab={section}
        onChange={setSection}
      />

      {section === "revenue" && <RevenueContent />}
      {section === "shopPulse" && (
        <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}>
          <WorkOrdersSection />
        </Suspense>
      )}
      {section === "shopStatus" && (
        <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>}>
          <DispatchSection />
        </Suspense>
      )}
    </div>
  );
}

// ─── REVENUE CONTENT (previously the entire RevenueSection) ───
function RevenueContent() {
  const [period, setPeriod] = useState(30);
  const [intelPeriod, setIntelPeriod] = useState<"7d" | "30d" | "90d" | "6mo" | "1yr" | "all">("30d");
  // wave-111 — was useState; now URL-persistent via useUrlFilter so a
  // refresh / deep-link / back-button doesn't bounce operator off the
  // invoices or create sub-tab back to dashboard.
  const [tab, setTab] = useUrlFilter<"dashboard" | "invoices" | "create">(
    "revTab",
    "dashboard",
    {
      validate: (raw) => (raw === "dashboard" || raw === "invoices" || raw === "create" ? raw : null),
    },
  );
  const { data: stats, isLoading } = trpc.invoices.stats.useQuery({ days: period }, { refetchInterval: 60000 });
  const { data: topCustomers } = trpc.invoices.topCustomers.useQuery({ limit: 10 });
  const { data: kpi } = trpc.kpi.current.useQuery(undefined, { refetchInterval: 60000 });
  const { data: shopFloor } = trpc.nourOsBridge.shopFloor.useQuery(undefined, { refetchInterval: 30000 });
  const { data: funnel } = trpc.workOrders.conversionFunnel.useQuery({ days: period }, { refetchInterval: 120000 });
  const { data: intel } = trpc.invoices.intelligence.useQuery({ period: intelPeriod }, { refetchInterval: 120000 });
  const { data: custIntel } = trpc.customers.intelligence.useQuery(undefined, { refetchInterval: 300000 });
  const utils = trpc.useUtils();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <SkeletonKpiGrid cols={4} />
        <SkeletonChart height={280} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      {/* wave-112 — was 3 hand-styled <button>s; switched to canonical TabBar
          (pill variant) so revenue sub-tabs match every other admin section.
          Outer Revenue tabs already use TabBar; inner ones drifted. */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <p className="text-[12px] text-foreground/40">Real-time financial intelligence</p>
        </div>
        <TabBar
          tabs={[
            { id: "dashboard" as const, label: "DASHBOARD" },
            { id: "invoices" as const, label: "INVOICES" },
            { id: "create" as const, label: "NEW", icon: <Plus className="w-3 h-3" /> },
          ]}
          activeTab={tab}
          onChange={setTab}
          variant="pill"
          size="compact"
        />
      </div>

      {tab === "dashboard" && <DashboardView stats={stats} topCustomers={topCustomers} kpi={kpi} shopFloor={shopFloor} funnel={funnel} period={period} setPeriod={setPeriod} intel={intel} intelPeriod={intelPeriod} setIntelPeriod={setIntelPeriod} custIntel={custIntel} />}
      {tab === "invoices" && <InvoiceListView onCreateNew={() => setTab("create")} />}
      {tab === "create" && <CreateInvoiceView onDone={() => { setTab("invoices"); utils.invoices.list.invalidate(); utils.invoices.stats.invalidate(); }} />}
    </div>
  );
}

// ─── DASHBOARD TYPES ────────────────────────────────────
interface FunnelStage { label: string; name?: string; count: number; revenue?: number }
interface PaymentBreakdown { method: string; amount: number }
interface TopCustomer { name: string; phone: string | null; total: number; count: number; lastVisit: Date }
interface ServiceItem { category: string; revenue: number; count: number; avgTicket: number }
interface TopDay { day: string; revenue: number; jobs: number }
interface IntelRecommendation { priority: string; type: string; text: string }
interface AtRiskWhaleRev { name: string; totalSpent: number; daysSince: number; visits?: number; phone?: string }
interface InvoiceItem {
  id: number;
  invoiceNumber?: string;
  invoiceDate: string;
  customerName?: string;
  customerPhone?: string;
  serviceDescription?: string;
  total: number;
  totalAmount?: number;
  partsCost?: number;
  laborCost?: number;
  taxAmount?: number;
  vehicleInfo?: string;
  paymentMethod?: string;
  paymentStatus?: string;
  source?: string;
  algTicketId?: string | null;
}

// DashboardView receives complex tRPC query results — typed at call sites instead
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DashboardViewProps = Record<string, any>;

// ─── DASHBOARD VIEW ─────────────────────────────────────
function DashboardView({ stats, topCustomers, kpi, shopFloor, funnel, period, setPeriod, intel, intelPeriod, setIntelPeriod, custIntel }: DashboardViewProps) {
  const revenueChange = stats?.periodComparison?.change ?? 0;

  // Monthly pace computation
  const monthRevenue = intel?.projections?.monthlyAvg ?? stats?.totalRevenue ?? 0;
  const monthTarget = MONTHLY_TARGET;
  const pacePercent = monthTarget > 0 ? Math.round((monthRevenue / monthTarget) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* ═══ AT A GLANCE — scope adapts to period ═══ */}
      <div className="bg-gradient-to-r from-primary/10 to-emerald-500/10 border border-primary/20 p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[15px] font-semibold text-foreground tracking-tight">
            {period === 1 ? "Today" : period === 7 ? "This week" : `Last ${period} days`}
          </h2>
          <span className="text-foreground/30 text-xs font-mono">{new Date().toLocaleDateString()}</span>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <p className="text-3xl font-bold text-primary">
              {formatDollars(period === 1 ? (stats?.totalRevenue ?? 0) : (intel?.weekOverWeek?.thisWeek ?? stats?.totalRevenue ?? 0))}
            </p>
            <p className="text-[11px] text-foreground/50 mt-0.5">
              {period === 1 ? "Today's Revenue" : period === 7 ? "This Week Revenue" : `${period}d Revenue`}
            </p>
          </div>
          <div>
            <p className="text-3xl font-bold text-emerald-400">{kpi?.completedThisWeek ?? stats?.invoiceCount ?? 0}</p>
            <p className="text-[11px] text-foreground/50 mt-0.5">Jobs Closed (Week)</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-blue-400">{kpi?.weekBookings ?? 0}</p>
            <p className="text-[11px] text-foreground/50 mt-0.5">New Bookings (Week)</p>
          </div>
          <div>
            <p className="text-3xl font-bold text-amber-400">{shopFloor?.active ?? 0}</p>
            <p className="text-[11px] text-foreground/50 mt-0.5">In Shop Now</p>
          </div>
        </div>
      </div>

      {/* ═══ MONTHLY PACE ═══ */}
      <div className="bg-card border border-border/30 p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-bold text-foreground/50 tracking-wider">MONTHLY PACE</span>
          <span className="font-mono text-xs text-foreground/40">{formatDollars(monthRevenue)} / {formatDollars(monthTarget)}</span>
        </div>
        <div className="h-3 bg-foreground/5 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${pacePercent >= 100 ? "bg-emerald-500" : pacePercent >= 60 ? "bg-primary" : "bg-amber-500"}`}
            style={{ width: `${Math.min(100, Math.max(2, pacePercent))}%` }}
          />
        </div>
        <p className="text-[10px] text-foreground/40 mt-1">
          {pacePercent >= 100
            ? "Target hit — keep pushing"
            : `${pacePercent}% of monthly target — ${formatDollars(monthTarget - monthRevenue)} to go`}
        </p>
      </div>

      {/* Period selector — expanded */}
      <div className="flex items-center gap-2 flex-wrap">
        {[1, 7, 30, 90].map((d: number) => (
          <button
            key={d}
            onClick={() => setPeriod(d)}
            className={`px-3 py-1.5 text-[12px] tracking-wider ${period === d ? "bg-primary text-primary-foreground" : "bg-card border border-border/30 text-foreground/60 hover:text-foreground"}`}
          >
            {d === 1 ? "TODAY" : `${d}D`}
          </button>
        ))}
      </div>

      {/* KPI Cards Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPICard label="Total Revenue" value={formatDollars(stats?.totalRevenue ?? 0)} icon={<DollarSign className="w-5 h-5" />} trend={revenueChange} trendLabel={`${revenueChange >= 0 ? "+" : ""}${revenueChange}% vs prev period`} color="text-primary" />
        <KPICard label="Avg Ticket" value={formatDollars(stats?.avgTicket ?? 0)} icon={<Target className="w-5 h-5" />} color="text-blue-400" />
        <KPICard label="Invoices" value={stats?.invoiceCount ?? 0} icon={<BarChart3 className="w-5 h-5" />} color="text-emerald-400" />
        <KPICard label="Conversion Rate" value={`${kpi?.conversionRate ?? 0}%`} icon={<Zap className="w-5 h-5" />} trendLabel="Leads → Bookings" color="text-purple-400" />
      </div>

      {/* Empty state hint when no revenue */}
      {(stats?.totalRevenue ?? 0) === 0 && (
        <div className="bg-primary/5 border border-primary/20 p-4 flex items-center gap-3">
          <Zap className="w-5 h-5 text-primary shrink-0" />
          <div>
            <p className="font-bold text-sm text-foreground">Revenue data syncs from Auto Labor Guide</p>
            <p className="text-foreground/50 text-xs">Invoices from ALG mirror every 15 minutes. Create invoices in ALG and they'll appear here automatically.</p>
          </div>
        </div>
      )}

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

      {/* Work Order Revenue Pipeline */}
      {(!shopFloor || (shopFloor.active === 0 && shopFloor.totalValueInProgress === 0)) && (
        <div className="bg-card border border-border/30 p-5">
          <h3 className="font-bold text-sm text-foreground tracking-wider mb-3 flex items-center gap-2">
            <Activity className="w-4 h-4 text-foreground/30" />
            REVENUE PIPELINE
          </h3>
          <p className="text-xs text-foreground/40">No active work orders. The shop floor syncs from ALG every 15 minutes.</p>
        </div>
      )}
      {shopFloor && (shopFloor.active > 0 || shopFloor.totalValueInProgress > 0) && (
        <div className="bg-card border border-primary/20 rounded-lg p-5">
          <h3 className="font-bold text-sm text-foreground tracking-wider mb-4 flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            REVENUE PIPELINE — WORK IN PROGRESS
          </h3>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="text-center p-3 rounded-md border border-border/30">
              <p className="text-2xl font-bold tracking-tight text-primary">{formatDollars(Math.round(shopFloor.totalValueInProgress))}</p>
              <p className="text-[10px] text-muted-foreground mt-1">Value In Shop</p>
            </div>
            <div className="text-center p-3 rounded-md border border-border/30">
              <p className="text-2xl font-bold tracking-tight text-blue-400">{shopFloor.active}</p>
              <p className="text-[10px] text-muted-foreground mt-1">Active Orders</p>
            </div>
            <div className="text-center p-3 rounded-md border border-border/30">
              <p className="text-2xl font-bold tracking-tight text-emerald-400">{shopFloor.inProgress}</p>
              <p className="text-[10px] text-muted-foreground mt-1">In Progress</p>
            </div>
            <div className="text-center p-3 rounded-md border border-border/30">
              <p className="text-2xl font-bold tracking-tight text-amber-400">{shopFloor.readyForPickup}</p>
              <p className="text-[10px] text-muted-foreground mt-1">Ready for Pickup</p>
            </div>
            <div className="text-center p-3 rounded-md border border-border/30">
              <p className={`text-2xl font-bold tracking-tight ${shopFloor.blocked > 0 ? "text-red-400" : "text-muted-foreground"}`}>{shopFloor.blocked}</p>
              <p className="text-[10px] text-muted-foreground mt-1">Blocked</p>
            </div>
          </div>
          {shopFloor.overdue > 0 && (
            <div className="mt-3 flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded text-[11px] text-red-400">
              <Clock className="w-3.5 h-3.5 shrink-0" />
              {shopFloor.overdue} overdue work order{shopFloor.overdue > 1 ? "s" : ""} — revenue stuck in pipeline
            </div>
          )}
        </div>
      )}

      {/* Conversion Funnel */}
      {funnel && funnel.totalCreated > 0 && (
        <div className="bg-card border border-border/30 p-5">
          <div className="flex items-center justify-between mb-5">
            <h3 className="font-bold text-sm text-foreground tracking-wider flex items-center gap-2">
              <Wrench className="w-4 h-4 text-primary" />
              WORK ORDER → REVENUE FUNNEL
            </h3>
            <span className="font-mono text-[10px] text-foreground/30">Last {period} days</span>
          </div>

          {/* Funnel stages */}
          <div className="flex items-center gap-1 mb-5">
            {funnel.stages.map((stage: FunnelStage, i: number) => {
              const maxCount = funnel.stages[0]?.count || 1;
              const pct = maxCount > 0 ? (stage.count / maxCount) * 100 : 0;
              const dropoff = i > 0 && funnel.stages[i - 1].count > 0
                ? Math.round((1 - stage.count / funnel.stages[i - 1].count) * 100)
                : 0;
              const stageColors = ["text-blue-400", "text-primary", "text-amber-400", "text-emerald-400", "text-emerald-400"];
              const stageBgs = ["bg-blue-500/20", "bg-primary/20", "bg-amber-500/20", "bg-emerald-500/20", "bg-emerald-500/20"];

              return (
                <div key={stage.name} className="flex items-center gap-1 flex-1">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-[9px] text-foreground/50 tracking-wide truncate">{stage.name}</span>
                      <span className={`font-bold text-sm ${stageColors[i]}`}>{stage.count}</span>
                    </div>
                    <div className="h-2.5 bg-foreground/5 rounded-sm overflow-hidden">
                      <div
                        className={`h-full rounded-sm transition-all duration-700 ${stageBgs[i]}`}
                        style={{ width: `${Math.max(pct, 3)}%` }}
                      />
                    </div>
                    {i > 0 && dropoff > 0 && (
                      <span className="font-mono text-[8px] text-red-400/60 mt-0.5 block">-{dropoff}% drop</span>
                    )}
                  </div>
                  {i < funnel.stages.length - 1 && (
                    <ArrowRight className="w-3 h-3 text-foreground/15 shrink-0 mx-0.5" />
                  )}
                </div>
              );
            })}
          </div>

          {/* Funnel KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="text-center p-3 rounded-md border border-border/30">
              <p className={`text-xl font-bold tracking-tight ${funnel.conversionRate >= 70 ? "text-emerald-400" : funnel.conversionRate >= 40 ? "text-amber-400" : "text-red-400"}`}>
                {funnel.conversionRate}%
              </p>
              <p className="text-[9px] text-muted-foreground mt-1">Conversion Rate</p>
            </div>
            <div className="text-center p-3 rounded-md border border-border/30">
              <p className="text-xl font-bold tracking-tight text-emerald-400">{formatDollars(funnel.revenueCompleted)}</p>
              <p className="text-[9px] text-muted-foreground mt-1">Revenue Captured</p>
            </div>
            <div className="text-center p-3 rounded-md border border-border/30">
              <p className={`text-xl font-bold tracking-tight ${funnel.revenueLost > 0 ? "text-red-400" : "text-foreground/30"}`}>
                {formatDollars(funnel.revenueLost)}
              </p>
              <p className="text-[9px] text-muted-foreground mt-1">Revenue Lost</p>
            </div>
            <div className="text-center p-3 rounded-md border border-border/30">
              <p className="text-xl font-bold tracking-tight text-foreground">
                {funnel.avgHoursToCycle != null
                  ? funnel.avgHoursToCycle < 24
                    ? `${funnel.avgHoursToCycle}h`
                    : `${(funnel.avgHoursToCycle / 24).toFixed(1)}d`
                  : "—"}
              </p>
              <p className="text-[9px] text-muted-foreground mt-1">Avg Cycle Time</p>
            </div>
            <div className="text-center p-3 rounded-md border border-border/30">
              <p className="text-xl font-bold tracking-tight text-foreground">
                {funnel.avgHoursToStart != null
                  ? funnel.avgHoursToStart < 24
                    ? `${funnel.avgHoursToStart}h`
                    : `${(funnel.avgHoursToStart / 24).toFixed(1)}d`
                  : "—"}
              </p>
              <p className="text-[9px] text-muted-foreground mt-1">Avg Time to Start</p>
            </div>
          </div>

          {/* Alerts */}
          {funnel.cancelled > 0 && funnel.cancelled / funnel.totalCreated > 0.15 && (
            <div className="mt-3 flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded text-[11px] text-red-400">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {Math.round((funnel.cancelled / funnel.totalCreated) * 100)}% cancellation rate — {funnel.cancelled} work order{funnel.cancelled > 1 ? "s" : ""} cancelled ({formatDollars(funnel.revenueLost)} lost)
            </div>
          )}
          {funnel.stillActive > 0 && (
            <div className="mt-2 flex items-center gap-2 px-3 py-2 bg-blue-500/10 border border-blue-500/20 rounded text-[11px] text-blue-400">
              <Activity className="w-3.5 h-3.5 shrink-0" />
              {funnel.stillActive} active work order{funnel.stillActive > 1 ? "s" : ""} in pipeline — {formatDollars(funnel.revenuePipeline)} pending
            </div>
          )}
        </div>
      )}

      {/* Revenue Chart */}
      <div className="bg-card border border-border/30 p-5">
        <h3 className="font-bold text-sm text-foreground tracking-[-0.01em] mb-4">REVENUE TREND</h3>
        {stats?.revenueByDay && stats.revenueByDay.length > 0 ? (
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.revenueByDay}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: CHART_THEME.axis }} tickFormatter={(v: string) => v.slice(5)} />
                <YAxis tick={{ fontSize: 10, fill: CHART_THEME.axis }} tickFormatter={(v: number) => `$${v.toLocaleString()}`} />
                <RechartsTooltip contentStyle={CHART_THEME.tooltip} formatter={(value: number) => [`$${value.toLocaleString()}`, "Revenue"]} />
                <Area type="monotone" dataKey="amount" stroke={CHART_THEME.primary} fill={CHART_THEME.primary} fillOpacity={0.15} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <BarChart3 className="w-8 h-8 text-foreground/10 mb-2" />
            <p className="text-xs text-foreground/30">Revenue trend appears after the first invoice is recorded.</p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {/* Payment Method Breakdown */}
        <div className="bg-card border border-border/30 p-5">
          <h3 className="font-bold text-sm text-foreground tracking-[-0.01em] mb-4">PAYMENT METHODS</h3>
          {stats?.revenueByPayment && stats.revenueByPayment.length > 0 ? (
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <RPieChart>
                  <Pie data={stats.revenueByPayment.map((d: PaymentBreakdown) => ({ ...d, name: d.method.toUpperCase() }))} dataKey="amount" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }: { name: string; percent: number }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {stats.revenueByPayment.map((_: PaymentBreakdown, i: number) => (<Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />))}
                  </Pie>
                  <RechartsTooltip contentStyle={CHART_THEME.tooltip} formatter={(value: number) => [`$${value.toLocaleString()}`, "Revenue"]} />
                </RPieChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <CreditCard className="w-7 h-7 text-foreground/10 mb-2" />
              <p className="text-xs text-foreground/30">Payment mix shows after invoices are created.</p>
            </div>
          )}
        </div>

        {/* Booking Heatmap (Day of Week) */}
        <div className="bg-card border border-border/30 p-5">
          <h3 className="font-bold text-sm text-foreground tracking-[-0.01em] mb-4">BOOKING HEATMAP — DAY OF WEEK</h3>
          {kpi?.dayOfWeekCounts && kpi.dayOfWeekCounts.some((c: number) => c > 0) ? (
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, i) => ({ day, count: kpi.dayOfWeekCounts[i] }))}>
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#888" }} />
                  <YAxis tick={{ fontSize: 10, fill: CHART_THEME.axis }} />
                  <RechartsTooltip contentStyle={CHART_THEME.tooltip} />
                  <Bar dataKey="count" fill={CHART_THEME.primary} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Calendar className="w-7 h-7 text-foreground/10 mb-2" />
              <p className="text-xs text-foreground/30">Booking patterns appear after customers start scheduling.</p>
            </div>
          )}
        </div>
      </div>

      {/* Hour-of-Day Heatmap */}
      {kpi?.hourCounts && (
        <div className="bg-card border border-border/30 p-5">
          <h3 className="font-bold text-sm text-foreground tracking-[-0.01em] mb-4">BOOKING HEATMAP — HOUR OF DAY</h3>
          <div className="flex items-end gap-1" style={{ height: 120 }}>
            {kpi.hourCounts.map((count: number, hour: number) => {
              const maxCount = Math.max(...kpi.hourCounts, 1);
              const pct = (count / maxCount) * 100;
              const isBusinessHour = hour >= 8 && hour <= 18;
              return (
                <div key={hour} className="flex-1 flex flex-col items-center gap-1" title={`${hour}:00 — ${count} bookings`}>
                  <div
                    className={`w-full rounded-t-sm ${isBusinessHour ? "bg-primary" : "bg-foreground/10"}`}
                    style={{ height: `${Math.max(pct, 2)}%`, minHeight: 2, opacity: isBusinessHour ? Math.max(0.2, pct / 100) : 0.3 }}
                  />
                  {(hour % 3 === 0) && (
                    <span className="font-mono text-[8px] text-foreground/30">{hour}</span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between mt-2">
            <span className="font-mono text-[9px] text-foreground/20">12AM</span>
            <span className="font-mono text-[9px] text-primary/40">Business Hours (8AM-6PM)</span>
            <span className="font-mono text-[9px] text-foreground/20">11PM</span>
          </div>
        </div>
      )}

      {/* Top Customers */}
      {topCustomers && topCustomers.length > 0 && (
        <div className="bg-card border border-border/30 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-sm text-foreground tracking-wider">TOP CUSTOMERS BY REVENUE</h3>
            <span className="font-mono text-[10px] text-foreground/30">Lifetime value</span>
          </div>
          <div className="space-y-2">
            {topCustomers.map((c: TopCustomer, i: number) => (
              <div key={i} className="flex items-center gap-4 py-2 border-b border-border/10 last:border-0">
                <span className="font-bold text-lg text-foreground/20 w-8">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <span className="font-bold text-sm text-foreground">{c.name}</span>
                  {c.phone && <span className="font-mono text-[10px] text-foreground/30 ml-2">{c.phone}</span>}
                </div>
                <div className="text-right">
                  <span className="font-bold text-sm text-primary">{formatCents(c.total)}</span>
                  <span className="font-mono text-[10px] text-foreground/30 block">{c.count} visits</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ DEEP INTELLIGENCE SECTION ═══ */}
      {intel && (
        <>
          {/* Intelligence Period Selector */}
          <div className="flex items-center justify-between flex-wrap gap-3 pt-4 border-t border-border/20">
            <h3 className="font-bold text-sm text-foreground tracking-wider flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" /> DEEP REVENUE INTELLIGENCE
            </h3>
            <div className="flex items-center gap-1.5">
              {(["7d", "30d", "90d", "6mo", "1yr", "all"] as const).map(p => (
                <button key={p} onClick={() => setIntelPeriod(p)}
                  className={`px-2.5 py-1 text-[10px] tracking-wider ${intelPeriod === p ? "bg-primary text-primary-foreground" : "bg-card border border-border/30 text-foreground/60 hover:text-foreground"}`}>
                  {p.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Intelligence Overview */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPICard label="Total Revenue" value={formatDollars(intel.overview.totalRevenue)} icon={<DollarSign className="w-5 h-5" />} color="text-primary" />
            <KPICard label="Avg Daily Revenue" value={formatDollars(intel.overview.avgDailyRevenue)} icon={<TrendingUp className="w-5 h-5" />} color="text-emerald-400" />
            <KPICard label="Unique Customers" value={intel.overview.uniqueCustomers} icon={<Users className="w-5 h-5" />} color="text-blue-400" />
            <KPICard label="Active Days" value={intel.overview.activeDays} icon={<Calendar className="w-5 h-5" />} color="text-purple-400" />
          </div>

          {/* Labor vs Parts Split */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="bg-card border border-border/30 p-5">
              <h3 className="font-bold text-sm text-foreground tracking-[-0.01em] mb-4">LABOR vs PARTS SPLIT</h3>
              <div className="flex items-center gap-4 mb-4">
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] text-foreground/60">Labor</span>
                    <span className="font-bold text-sm text-blue-400">{formatDollars(intel.laborVsParts.laborTotal)} ({intel.laborVsParts.laborPct}%)</span>
                  </div>
                  <div className="h-3 bg-foreground/5 rounded-sm overflow-hidden">
                    <div className="h-full bg-blue-500/40 rounded-sm" style={{ width: `${intel.laborVsParts.laborPct}%` }} />
                  </div>
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] text-foreground/60">Parts</span>
                    <span className="font-bold text-sm text-emerald-400">{formatDollars(intel.laborVsParts.partsTotal)} ({intel.laborVsParts.partsPct}%)</span>
                  </div>
                  <div className="h-3 bg-foreground/5 rounded-sm overflow-hidden">
                    <div className="h-full bg-emerald-500/40 rounded-sm" style={{ width: `${intel.laborVsParts.partsPct}%` }} />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-2 rounded border border-border/20">
                  <p className="text-lg font-bold text-blue-400">{intel.laborVsParts.laborOnlyJobs}</p>
                  <p className="text-[9px] text-foreground/40">Labor Only</p>
                </div>
                <div className="p-2 rounded border border-border/20">
                  <p className="text-lg font-bold text-emerald-400">{intel.laborVsParts.partsOnlyJobs}</p>
                  <p className="text-[9px] text-foreground/40">Parts Only</p>
                </div>
                <div className="p-2 rounded border border-border/20">
                  <p className="text-lg font-bold text-primary">{intel.laborVsParts.bothJobs}</p>
                  <p className="text-[9px] text-foreground/40">Both</p>
                </div>
              </div>
            </div>

            {/* Service Category Breakdown */}
            <div className="bg-card border border-border/30 p-5">
              <h3 className="font-bold text-sm text-foreground tracking-[-0.01em] mb-4">SERVICE BREAKDOWN</h3>
              <div className="space-y-2 max-h-[280px] overflow-y-auto">
                {intel.serviceBreakdown.map((s: ServiceItem, i: number) => {
                  const maxRev = intel.serviceBreakdown[0]?.revenue || 1;
                  return (
                    <div key={s.category} className="flex items-center gap-3">
                      <span className="text-[10px] text-foreground/60 w-24 truncate">{s.category}</span>
                      <div className="flex-1 h-5 bg-foreground/5 rounded-sm overflow-hidden relative">
                        <div className="h-full rounded-sm" style={{ width: `${(s.revenue / maxRev) * 100}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length], opacity: 0.4 }} />
                        <span className="absolute right-2 top-0.5 text-[10px] font-bold text-foreground/80">{formatDollars(s.revenue)}</span>
                      </div>
                      <span className="text-[10px] text-foreground/40 w-12 text-right">{s.count} jobs</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Monthly Trend with Labor/Parts Stack */}
          {intel.monthlyTrend.length > 1 && (
            <div className="bg-card border border-border/30 p-5">
              <h3 className="font-bold text-sm text-foreground tracking-[-0.01em] mb-4">MONTHLY REVENUE TREND (LABOR + PARTS)</h3>
              <div style={{ height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={intel.monthlyTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
                    <XAxis dataKey="month" tick={{ fontSize: 10, fill: CHART_THEME.axis }} />
                    <YAxis tick={{ fontSize: 10, fill: CHART_THEME.axis }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}K`} />
                    <RechartsTooltip contentStyle={CHART_THEME.tooltip}
                      formatter={(value: number, name: string) => [`$${value.toLocaleString()}`, name.charAt(0).toUpperCase() + name.slice(1)]} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="labor" stackId="rev" fill={CHART_THEME.secondary} name="Labor" radius={[0, 0, 0, 0]} />
                    <Bar dataKey="parts" stackId="rev" fill={CHART_THEME.tertiary} name="Parts" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Day of Week Revenue + Payment Mix */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {intel.dayOfWeek.length > 0 && (
              <div className="bg-card border border-border/30 p-5">
                <h3 className="font-bold text-sm text-foreground tracking-[-0.01em] mb-4">REVENUE BY DAY OF WEEK</h3>
                <div style={{ height: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={intel.dayOfWeek}>
                      <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#888" }} tickFormatter={(v: string) => v.slice(0, 3)} />
                      <YAxis tick={{ fontSize: 10, fill: CHART_THEME.axis }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}K`} />
                      <RechartsTooltip contentStyle={CHART_THEME.tooltip}
                        formatter={(value: number) => [`$${value.toLocaleString()}`, "Revenue"]} />
                      <Bar dataKey="revenue" fill={CHART_THEME.primary} radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Avg Ticket by Service */}
            {intel.serviceBreakdown.length > 0 && (
              <div className="bg-card border border-border/30 p-5">
                <h3 className="font-bold text-sm text-foreground tracking-[-0.01em] mb-4">AVG TICKET BY SERVICE</h3>
                <div style={{ height: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={intel.serviceBreakdown.filter((s: ServiceItem) => s.category !== "Other").slice(0, 8)} layout="vertical">
                      <XAxis type="number" tick={{ fontSize: 10, fill: CHART_THEME.axis }} tickFormatter={(v: number) => `$${v}`} />
                      <YAxis type="category" dataKey="category" tick={{ fontSize: 10, fill: "#888" }} width={80} />
                      <RechartsTooltip contentStyle={CHART_THEME.tooltip}
                        formatter={(value: number) => [`$${value.toLocaleString()}`, "Avg Ticket"]} />
                      <Bar dataKey="avgTicket" fill={CHART_THEME.quaternary} radius={[0, 2, 2, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>

          {/* Week-over-Week Growth */}
          {intel.weekOverWeek && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
              <div className="bg-card border border-border/30 p-5 text-center">
                <p className="text-[10px] text-foreground/40 mb-1">THIS WEEK</p>
                <p className="text-3xl font-bold text-primary">{formatDollars(intel.weekOverWeek.thisWeek)}</p>
              </div>
              <div className="bg-card border border-border/30 p-5 text-center">
                <p className="text-[10px] text-foreground/40 mb-1">LAST WEEK</p>
                <p className="text-3xl font-bold text-foreground/60">{formatDollars(intel.weekOverWeek.prevWeek)}</p>
              </div>
              <div className="bg-card border border-border/30 p-5 text-center">
                <p className="text-[10px] text-foreground/40 mb-1">WEEK-OVER-WEEK</p>
                <p className={`text-3xl font-bold flex items-center justify-center gap-1 ${intel.weekOverWeek.growth >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {intel.weekOverWeek.growth >= 0 ? <ArrowUpRight className="w-5 h-5" /> : <ArrowDownRight className="w-5 h-5" />}
                  {intel.weekOverWeek.growth >= 0 ? "+" : ""}{intel.weekOverWeek.growth}%
                </p>
              </div>
            </div>
          )}

          {/* Daily Revenue Velocity — jobs + revenue per day scatter/line */}
          {intel.dailyVelocity && intel.dailyVelocity.length > 1 && (
            <div className="bg-card border border-border/30 p-5">
              <h3 className="font-bold text-sm text-foreground tracking-[-0.01em] mb-4 flex items-center gap-2">
                <Zap className="w-4 h-4 text-primary" /> DAILY REVENUE VELOCITY
              </h3>
              <div style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={intel.dailyVelocity}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
                    <XAxis dataKey="day" tick={{ fontSize: 9, fill: CHART_THEME.axis }} tickFormatter={(v: string) => v.slice(5)} />
                    <YAxis yAxisId="rev" tick={{ fontSize: 10, fill: CHART_THEME.axis }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}K`} />
                    <YAxis yAxisId="jobs" orientation="right" tick={{ fontSize: 10, fill: CHART_THEME.axis }} />
                    <RechartsTooltip contentStyle={CHART_THEME.tooltip}
                      formatter={(value: number, name: string) => [name === "jobs" ? value : `$${value.toLocaleString()}`, name === "jobs" ? "Jobs" : name === "avgTicket" ? "Avg Ticket" : "Revenue"]} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Line yAxisId="rev" type="monotone" dataKey="revenue" stroke={CHART_THEME.primary} strokeWidth={2} dot={false} name="Revenue" />
                    <Line yAxisId="rev" type="monotone" dataKey="avgTicket" stroke={CHART_THEME.quaternary} strokeWidth={1.5} dot={false} strokeDasharray="4 2" name="Avg Ticket" />
                    <Line yAxisId="jobs" type="monotone" dataKey="jobs" stroke={CHART_THEME.secondary} strokeWidth={1.5} dot={false} name="Jobs" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Weekly Trend */}
          {intel.weeklyTrend && intel.weeklyTrend.length > 2 && (
            <div className="bg-card border border-border/30 p-5">
              <h3 className="font-bold text-sm text-foreground tracking-[-0.01em] mb-4">WEEKLY REVENUE TREND</h3>
              <div style={{ height: 240 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={intel.weeklyTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke={CHART_THEME.grid} />
                    <XAxis dataKey="week" tick={{ fontSize: 9, fill: CHART_THEME.axis }} tickFormatter={(v: string) => v?.slice(5) || ""} />
                    <YAxis tick={{ fontSize: 10, fill: CHART_THEME.axis }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}K`} />
                    <RechartsTooltip contentStyle={CHART_THEME.tooltip}
                      formatter={(value: number) => [`$${value.toLocaleString()}`, "Revenue"]} />
                    <Area type="monotone" dataKey="revenue" stroke={CHART_THEME.tertiary} fill={CHART_THEME.tertiary} fillOpacity={0.15} strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Projections + Target — heading reads from BUSINESS so it stays
              in sync with the dynamic target. Hardcoded "$20K" was stale. */}
          <div className="bg-card border border-primary/20 p-5">
            <h3 className="font-bold text-sm text-foreground tracking-wider mb-4 flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" /> ${(MONTHLY_TARGET / 1000).toFixed(0)}K MONTHLY RUN-RATE
            </h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="text-center p-3 rounded border border-border/20">
                <p className="text-2xl font-bold text-primary">{formatDollars(intel.projections.monthlyAvg)}</p>
                <p className="text-[9px] text-foreground/40 mt-1">Monthly Avg (recent 3mo)</p>
              </div>
              <div className="text-center p-3 rounded border border-border/20">
                <p className="text-2xl font-bold text-emerald-400">{formatDollars(intel.projections.annualProjection)}</p>
                <p className="text-[9px] text-foreground/40 mt-1">Annual Projection</p>
              </div>
              <div className="text-center p-3 rounded border border-border/20">
                <p className="text-2xl font-bold text-blue-400">{formatDollars(intel.projections.dailyTarget)}</p>
                <p className="text-[9px] text-foreground/40 mt-1">Daily Target (26 days)</p>
              </div>
              <div className="text-center p-3 rounded border border-border/20">
                {/* Replaced the old "$20K goal gap" tile. Now shows monthly
                    average run-rate as a contextual figure — no fixed goal,
                    just current trajectory. */}
                <p className="text-2xl font-bold text-emerald-400">
                  ${Math.round(intel.projections.monthlyAvg).toLocaleString()}
                </p>
                <p className="text-[9px] text-foreground/40 mt-1">monthly avg run-rate</p>
              </div>
            </div>
          </div>

          {/* Top Revenue Days */}
          {intel.topDays.length > 0 && (
            <div className="bg-card border border-border/30 p-5">
              <h3 className="font-bold text-sm text-foreground tracking-[-0.01em] mb-4 flex items-center gap-2">
                <Star className="w-4 h-4 text-primary" /> TOP REVENUE DAYS
              </h3>
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
                {intel.topDays.slice(0, 10).map((d: TopDay, i: number) => (
                  <div key={d.day} className={`text-center p-3 rounded border ${i === 0 ? "border-primary/30 bg-primary/5" : "border-border/20"}`}>
                    <p className="text-lg font-bold text-primary">{formatDollars(d.revenue)}</p>
                    <p className="text-[9px] text-foreground/40">{d.day} ({d.jobs} jobs)</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ═══ SMART RECOMMENDATIONS ═══ */}
      {intel?.recommendations && intel.recommendations.length > 0 && (
        <div className="bg-card border border-primary/20 p-5">
          <h3 className="font-bold text-sm text-foreground tracking-wider mb-3 flex items-center gap-2">
            <Zap className="w-4 h-4 text-primary" /> WHAT TO DO NOW
          </h3>
          <div className="space-y-2">
            {intel.recommendations.map((r: IntelRecommendation, i: number) => (
              <div key={i} className={`flex items-start gap-3 p-3 rounded border ${
                r.priority === "high" ? "border-red-500/20 bg-red-500/5" :
                r.priority === "medium" ? "border-amber-500/20 bg-amber-500/5" :
                "border-border/20"
              }`}>
                <span className={`text-[9px] font-bold uppercase shrink-0 mt-0.5 ${
                  r.type === "revenue" ? "text-emerald-400" : r.type === "risk" ? "text-red-400" : "text-blue-400"
                }`}>{r.type}</span>
                <p className="text-xs text-foreground/80 flex-1">{r.text}</p>
                <span className={`text-[8px] font-bold uppercase shrink-0 ${
                  r.priority === "high" ? "text-red-400" : "text-amber-400"
                }`}>{r.priority}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ CUSTOMER INTELLIGENCE ═══ */}
      {custIntel && (
        <div className="bg-card border border-border/30 p-5">
          <h3 className="font-bold text-sm text-foreground tracking-wider mb-4 flex items-center gap-2">
            <Users className="w-4 h-4 text-blue-400" /> CUSTOMER INTELLIGENCE
          </h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            <div className="text-center p-3 rounded border border-primary/20 bg-primary/5">
              <p className="text-2xl font-bold text-primary">{custIntel.spendTiers.whales.count}</p>
              <p className="text-[9px] text-foreground/40 mt-1">Whales ($2K+)</p>
            </div>
            <div className="text-center p-3 rounded border border-blue-500/20 bg-blue-500/5">
              <p className="text-2xl font-bold text-blue-400">{custIntel.spendTiers.regulars.count}</p>
              <p className="text-[9px] text-foreground/40 mt-1">Regulars ($500-$2K)</p>
            </div>
            <div className="text-center p-3 rounded border border-emerald-500/20 bg-emerald-500/5">
              <p className="text-2xl font-bold text-emerald-400">{custIntel.spendTiers.oneTimers.count}</p>
              <p className="text-[9px] text-foreground/40 mt-1">One-Timers (&lt;$500)</p>
            </div>
            <div className="text-center p-3 rounded border border-red-500/20 bg-red-500/5">
              <p className="text-2xl font-bold text-red-400">{custIntel.churnRisk.atRisk}</p>
              <p className="text-[9px] text-foreground/40 mt-1">Churn Risk (60-180d quiet)</p>
            </div>
          </div>
          {/* Win-back potential */}
          {custIntel.churnRisk.winbackTargets > 0 && (
            <div className="flex items-center gap-3 p-3 rounded bg-amber-500/5 border border-amber-500/20 mb-3">
              <TrendingUp className="w-4 h-4 text-amber-400 shrink-0" />
              <p className="text-xs text-foreground/70">
                <span className="font-bold text-amber-400">{custIntel.churnRisk.winbackTargets}</span> dormant customers with
                <span className="font-bold text-primary"> ${custIntel.churnRisk.winbackPotential.toLocaleString()}</span> in past revenue — win-back SMS campaign ready
              </p>
            </div>
          )}
          {/* At-risk whales */}
          {custIntel.atRiskWhales.length > 0 && (
            <div>
              <p className="text-[10px] text-foreground/40 font-bold uppercase mb-2">High-Value Customers Going Quiet</p>
              <div className="space-y-1">
                {custIntel.atRiskWhales.map((w: AtRiskWhaleRev, i: number) => (
                  <div key={i} className="flex items-center gap-3 py-1.5 px-2 rounded bg-red-500/5 border border-red-500/10">
                    <span className="text-xs font-medium text-foreground flex-1">{w.name}</span>
                    <span className="text-xs font-bold text-primary">${w.totalSpent.toLocaleString()}</span>
                    <span className="text-[10px] text-foreground/40">{w.visits} visits</span>
                    <span className="text-[10px] text-red-400 font-bold">{w.daysSince}d ago</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tire Sales Panel — wave-99 */}
      <TireSalesPanel />

      {/* Empty state */}
      {(!stats?.revenueByDay || stats.revenueByDay.length === 0) && (
        <div className="bg-card border border-border/30 p-12 text-center">
          <DollarSign className="w-10 h-10 mx-auto mb-3 text-foreground/20" />
          <h3 className="font-bold text-foreground tracking-[-0.01em] mb-2">NO REVENUE DATA YET</h3>
          <p className="text-[12px] text-foreground/40 max-w-md mx-auto">
            Revenue data populates when invoices are created — either manually, from ShopDriver imports, or from Stripe payments.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── TIRE SALES PANEL (wave-99) ────────────────────────────
// Aggregates invoices where serviceDescription matches "tire" — gives
// operator visibility into tire-specific revenue without needing
// per-line-item data (which ALG's REST API doesn't expose).
function TireSalesPanel() {
  const [months, setMonths] = useState(12);
  const { data, isLoading } = trpc.invoices.tireSalesReport.useQuery({ months });
  if (isLoading || !data) return null;
  const { totals, byMonth, topJobs, topCustomers } = data;
  if (totals.jobs === 0) return null;

  const maxMonthRevenue = Math.max(...byMonth.map((m) => m.revenue), 1);

  return (
    <div className="bg-card border border-border/30">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border/20 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
            <Activity className="w-4 h-4 text-blue-400" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-foreground tracking-wider">TIRE SALES REPORT</h3>
            <p className="text-[10px] text-foreground/40">
              From invoices with "tire" in service description ({months}-month window)
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {[3, 6, 12, 24].map((m) => (
            <button
              key={m}
              onClick={() => setMonths(m)}
              className={`px-2.5 py-1 text-[10px] tracking-wider transition-colors ${
                months === m
                  ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                  : "bg-card border border-border/30 text-foreground/40 hover:text-foreground/60"
              }`}
            >
              {m}M
            </button>
          ))}
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border/10">
        <div className="bg-card p-4">
          <span className="block text-[10px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-1.5">TIRE REVENUE</span>
          <span className="font-bold text-2xl text-emerald-400">${totals.revenue.toLocaleString()}</span>
        </div>
        <div className="bg-card p-4">
          <span className="block text-[10px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-1.5">TIRE JOBS</span>
          <span className="font-bold text-2xl text-foreground">{totals.jobs.toLocaleString()}</span>
        </div>
        <div className="bg-card p-4">
          <span className="block text-[10px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-1.5">AVG TICKET</span>
          <span className="font-bold text-2xl text-blue-400">${totals.avgTicket.toLocaleString()}</span>
        </div>
        <div className="bg-card p-4">
          <span className="block text-[10px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-1.5">UNIQUE CUSTOMERS</span>
          <span className="font-bold text-2xl text-purple-400">{totals.uniqueCustomers.toLocaleString()}</span>
        </div>
      </div>

      {/* Monthly bar chart + top jobs side-by-side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-border/10">
        {/* Monthly trend */}
        <div className="bg-card p-5">
          <span className="block text-[10px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-3">MONTHLY REVENUE</span>
          {byMonth.length === 0 ? (
            <p className="text-[11px] text-foreground/30 italic">No tire jobs in window</p>
          ) : (
            <div className="space-y-1.5">
              {byMonth.slice().reverse().slice(0, 12).map((m) => {
                const pct = (m.revenue / maxMonthRevenue) * 100;
                return (
                  <div key={m.month} className="flex items-center gap-2">
                    <span className="font-mono text-[9px] text-foreground/40 w-14 shrink-0">{m.month}</span>
                    <div className="flex-1 h-4 bg-foreground/5 relative">
                      <div className="h-full bg-emerald-500/40" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="font-mono text-[9px] text-emerald-400 w-16 text-right">${m.revenue.toLocaleString()}</span>
                    <span className="font-mono text-[9px] text-foreground/40 w-8 text-right">{m.jobs}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Top jobs */}
        <div className="bg-card p-5">
          <span className="block text-[10px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-3">TOP TIRE JOBS</span>
          {topJobs.length === 0 ? (
            <p className="text-[11px] text-foreground/30 italic">No tire jobs in window</p>
          ) : (
            <div className="space-y-1.5">
              {topJobs.slice(0, 10).map((j) => (
                <div key={j.description} className="flex items-center gap-2 py-1 border-b border-border/10">
                  <span className="text-[11px] text-foreground/70 flex-1 truncate">{j.description}</span>
                  <span className="font-mono text-[9px] text-foreground/40 w-8 text-right">{j.jobs}</span>
                  <span className="font-mono text-[10px] text-emerald-400 w-16 text-right">${j.revenue.toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Top tire customers */}
      <div className="bg-card p-5 border-t border-border/10">
        <span className="block text-[10px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-3">TOP TIRE CUSTOMERS</span>
        {topCustomers.length === 0 ? (
          <p className="text-[11px] text-foreground/30 italic">No tire customers in window</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {topCustomers.slice(0, 10).map((c, i: number) => (
              <div key={i} className="flex items-center gap-2 py-1 border-b border-border/10">
                <span className="font-mono text-[9px] text-foreground/30 w-4">{i + 1}</span>
                <span className="text-[11px] text-foreground flex-1 truncate">{c.customerName}</span>
                {c.customerPhone && (
                  <a href={`tel:${c.customerPhone}`} className="text-foreground/30 hover:text-primary" onClick={e => e.stopPropagation()} title={c.customerPhone}>
                    <Phone className="w-3 h-3" />
                  </a>
                )}
                <span className="font-mono text-[9px] text-foreground/40 w-8 text-right">{c.jobs}</span>
                <span className="font-mono text-[10px] text-emerald-400 w-16 text-right">${c.spent.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── INVOICE LIST VIEW ──────────────────────────────────
function InvoiceListView({ onCreateNew }: { onCreateNew: () => void }) {
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<"date" | "amount">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const { data, isLoading } = trpc.invoices.list.useQuery({ search: search || undefined, limit: 50 });
  const utils = trpc.useUtils();

  const deleteInvoice = trpc.invoices.delete.useMutation({
    onSuccess: () => { utils.invoices.list.invalidate(); utils.invoices.stats.invalidate(); toast.success("Invoice deleted"); },
    onError: (err: { message: string }) => toast.error(err.message),
  });

  const toggleSort = (field: "date" | "amount") => {
    if (sortField === field) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  };

  const sortedItems = useMemo(() => {
    if (!data?.items) return [];
    return [...data.items].sort((a: InvoiceItem, b: InvoiceItem) => {
      if (sortField === "date") {
        const diff = new Date(a.invoiceDate).getTime() - new Date(b.invoiceDate).getTime();
        return sortDir === "asc" ? diff : -diff;
      }
      const diff = (a.totalAmount ?? 0) - (b.totalAmount ?? 0);
      return sortDir === "asc" ? diff : -diff;
    });
  }, [data?.items, sortField, sortDir]);

  const SortIcon = ({ field }: { field: "date" | "amount" }) => {
    if (sortField !== field) return <ChevronDown className="w-2.5 h-2.5 text-foreground/15 inline ml-0.5" />;
    return sortDir === "asc"
      ? <ChevronUp className="w-2.5 h-2.5 text-primary inline ml-0.5" />
      : <ChevronDown className="w-2.5 h-2.5 text-primary inline ml-0.5" />;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground/30" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search invoices by name, number, or service..."
            className="w-full bg-card border border-border/30 pl-10 pr-4 py-2 text-[12px] text-foreground placeholder:text-foreground/20 focus:border-primary/50 focus:outline-none"
          />
        </div>
        <button onClick={onCreateNew} className="px-4 py-2 bg-primary text-primary-foreground font-bold text-xs tracking-wider flex items-center gap-1">
          <Plus className="w-3.5 h-3.5" /> CREATE
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
      ) : (data?.items?.length ?? 0) === 0 ? (
        <div className="bg-card border border-border/30 p-12 text-center">
          <FileText className="w-8 h-8 mx-auto mb-3 text-foreground/20" />
          <h3 className="font-bold text-foreground tracking-[-0.01em] mb-2">NO INVOICES</h3>
          <p className="text-[12px] text-foreground/40 mb-4">Create your first invoice to start tracking revenue.</p>
          <button onClick={onCreateNew} className="px-4 py-2 bg-primary text-primary-foreground font-bold text-xs tracking-wider">CREATE INVOICE</button>
        </div>
      ) : (
        <div className="space-y-1">
          {/* Table header — sortable columns */}
          <div className="grid grid-cols-12 gap-2 px-4 py-2 text-[9px] text-foreground/30 tracking-wide">
            <div className="col-span-1">#</div>
            <div className="col-span-3">Customer</div>
            <div className="col-span-2">Service</div>
            <div className="col-span-1">Method</div>
            <div className="col-span-1">Status</div>
            <div className="col-span-1 cursor-pointer select-none hover:text-foreground/60" role="button" aria-label="Sort by amount" onClick={() => toggleSort("amount")}>
              Amount <SortIcon field="amount" />
            </div>
            <div className="col-span-1 cursor-pointer select-none hover:text-foreground/60" role="button" aria-label="Sort by date" onClick={() => toggleSort("date")}>
              Date <SortIcon field="date" />
            </div>
            <div className="col-span-2"></div>
          </div>
          {sortedItems.map((inv: InvoiceItem, _iIdx: number) => {
            const isExpanded = expandedId === inv.id;
            const total = inv.totalAmount ?? inv.total ?? 0;
            const parts = inv.partsCost ?? 0;
            const labor = inv.laborCost ?? 0;
            const tax = inv.taxAmount ?? 0;
            const partsPct = total > 0 ? Math.round((parts / total) * 100) : 0;
            const laborPct = total > 0 ? Math.round((labor / total) * 100) : 0;
            const taxPct = total > 0 ? Math.round((tax / total) * 100) : 0;
            return (
            <React.Fragment key={inv.id}>
            <div
              className={`stagger-in grid grid-cols-12 gap-2 items-center px-4 py-3 bg-card border ${isExpanded ? "border-primary/30" : "border-border/20 hover:border-border/40"} transition-colors cursor-pointer`}
              style={{ animationDelay: `${_iIdx * 40}ms` }}
              onClick={() => setExpandedId(isExpanded ? null : inv.id)}
            >
              <div className="col-span-1 text-[10px] text-foreground/30 flex items-center gap-1">
                {isExpanded
                  ? <ChevronUp className="w-3 h-3 text-primary shrink-0" />
                  : <ChevronDown className="w-3 h-3 text-foreground/20 shrink-0" />
                }
                {inv.invoiceNumber || inv.id}
              </div>
              <div className="col-span-3">
                <span className="font-bold text-xs text-foreground block truncate">{inv.customerName}</span>
                {inv.customerPhone && <span className="font-mono text-[9px] text-foreground/30">{inv.customerPhone}</span>}
              </div>
              <div className="col-span-2 text-[10px] text-foreground/50 truncate">{inv.serviceDescription || "—"}</div>
              <div className="col-span-1">
                <span className="font-mono text-[9px] text-foreground/40 uppercase">{inv.paymentMethod}</span>
              </div>
              <div className="col-span-1">
                <span className={`font-mono text-[9px] px-1.5 py-0.5 ${
                  inv.paymentStatus === "paid" ? "bg-emerald-500/20 text-emerald-400" :
                  inv.paymentStatus === "pending" ? "bg-amber-500/20 text-amber-400" :
                  inv.paymentStatus === "partial" ? "bg-red-500/20 text-red-400" :
                  inv.paymentStatus === "refunded" ? "bg-red-500/20 text-red-400" :
                  "bg-blue-500/20 text-blue-400"
                }`}>
                  {inv.paymentStatus?.toUpperCase()}
                </span>
              </div>
              <div className="col-span-1 font-bold text-sm text-primary">{formatCents(total)}</div>
              <div className="col-span-1 text-[9px] text-foreground/30">
                {new Date(inv.invoiceDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </div>
              <div className="col-span-2 flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                {(inv.paymentStatus === "pending" || inv.paymentStatus === "partial") && inv.customerPhone && (
                  <a
                    href={`sms:${inv.customerPhone}?body=Hi ${inv.customerName?.split(" ")[0] || ""}, this is Nick's Tire %26 Auto. Your invoice of ${formatCents(total)} is still outstanding. Reply or call us to settle. Thanks!`}
                    className="p-1 text-foreground/20 hover:text-blue-400 transition-colors"
                    title="SMS follow-up"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                  </a>
                )}
                <button
                  onClick={() => {
                    if (confirm("Delete this invoice?")) deleteInvoice.mutate({ id: inv.id });
                  }}
                  className="p-1 text-foreground/20 hover:text-red-400 transition-colors"
                  title="Delete"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            {/* Expanded detail panel — shows breakdown we capture from ALG */}
            {isExpanded && (
              <div className="stagger-in bg-background/40 border-l-2 border-primary/30 px-6 py-4 -mt-1 mb-1 space-y-3">
                {/* Vehicle + Customer secondary info */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <span className="block text-[10px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-1.5">
                      <Car className="w-3 h-3 inline mr-1" />VEHICLE
                    </span>
                    <span className="text-xs text-foreground">
                      {inv.vehicleInfo || <span className="italic text-foreground/30">No vehicle on invoice</span>}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-1.5">
                      <Hash className="w-3 h-3 inline mr-1" />SOURCE
                    </span>
                    <span className="text-xs text-foreground/70 uppercase">
                      {inv.source || "manual"}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-1.5">
                      <Calendar className="w-3 h-3 inline mr-1" />DATE
                    </span>
                    <span className="text-xs text-foreground/70">
                      {new Date(inv.invoiceDate).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                    </span>
                  </div>
                </div>

                {/* Cost breakdown */}
                <div>
                  <span className="block text-[10px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-2">
                    <DollarSign className="w-3 h-3 inline mr-1" />COST BREAKDOWN
                  </span>
                  {(parts > 0 || labor > 0 || tax > 0) ? (
                    <div className="space-y-2">
                      {/* Visual proportion bar */}
                      <div className="flex h-2 bg-foreground/5 overflow-hidden">
                        {parts > 0 && <div className="bg-blue-500/60" style={{ width: `${partsPct}%` }} title={`Parts ${partsPct}%`} />}
                        {labor > 0 && <div className="bg-emerald-500/60" style={{ width: `${laborPct}%` }} title={`Labor ${laborPct}%`} />}
                        {tax > 0 && <div className="bg-amber-500/60" style={{ width: `${taxPct}%` }} title={`Tax ${taxPct}%`} />}
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="bg-card border border-border/20 p-2.5">
                          <span className="block text-[10px] uppercase tracking-[0.12em] text-foreground/45 font-medium mb-0.5">PARTS</span>
                          <div className="flex items-baseline gap-2">
                            <span className="font-bold text-base text-blue-400">{parts > 0 ? formatCents(parts) : "—"}</span>
                            {parts > 0 && <span className="text-[9px] text-foreground/40">{partsPct}%</span>}
                          </div>
                        </div>
                        <div className="bg-card border border-border/20 p-2.5">
                          <span className="block text-[10px] uppercase tracking-[0.12em] text-foreground/45 font-medium mb-0.5">LABOR</span>
                          <div className="flex items-baseline gap-2">
                            <span className="font-bold text-base text-emerald-400">{labor > 0 ? formatCents(labor) : "—"}</span>
                            {labor > 0 && <span className="text-[9px] text-foreground/40">{laborPct}%</span>}
                          </div>
                        </div>
                        <div className="bg-card border border-border/20 p-2.5">
                          <span className="block text-[10px] uppercase tracking-[0.12em] text-foreground/45 font-medium mb-0.5">TAX</span>
                          <div className="flex items-baseline gap-2">
                            <span className="font-bold text-base text-amber-400">{tax > 0 ? formatCents(tax) : "—"}</span>
                            {tax > 0 && <span className="text-[9px] text-foreground/40">{taxPct}%</span>}
                          </div>
                        </div>
                        <div className="bg-card border border-primary/30 p-2.5">
                          <span className="block text-[10px] uppercase tracking-[0.12em] text-foreground/45 font-medium mb-0.5">TOTAL</span>
                          <span className="font-bold text-base text-primary">{formatCents(total)}</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11px] text-foreground/40 italic">
                      No parts/labor breakdown on this invoice. (ALG returns rolled-up totals only — for the full job/tire breakdown, click "OPEN IN ALG" below.)
                    </p>
                  )}
                </div>

                {/* Action buttons */}
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/10">
                  {inv.customerPhone && (
                    <>
                      <a
                        href={`tel:${inv.customerPhone}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] tracking-wider bg-card border border-border/30 text-foreground/60 hover:text-primary hover:border-primary/30 transition-colors"
                      >
                        <Phone className="w-3 h-3" /> CALL
                      </a>
                      <a
                        href={`sms:${inv.customerPhone}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] tracking-wider bg-card border border-border/30 text-foreground/60 hover:text-blue-400 hover:border-blue-400/30 transition-colors"
                      >
                        <MessageSquare className="w-3 h-3" /> SMS
                      </a>
                    </>
                  )}
                  <a
                    href={inv.algTicketId
                      ? `https://secure.autolaborexperts.com/ticket/${inv.algTicketId}`
                      : "https://secure.autolaborexperts.com/recent"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] tracking-wider bg-card border border-purple-500/20 text-purple-400 hover:bg-purple-500/5 transition-colors"
                    title={inv.algTicketId
                      ? "Opens this ticket directly in ALG (full job/labor/parts breakdown)"
                      : "Opens ALG Recent Tickets — search for this invoice number"}
                  >
                    <ExternalLink className="w-3 h-3" /> OPEN IN ALG
                  </a>
                </div>
              </div>
            )}
            </React.Fragment>
            );
          })}
          <div className="text-center py-2">
            <span className="font-mono text-[9px] text-foreground/20">{data?.total ?? 0} total invoices</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── CREATE INVOICE VIEW ────────────────────────────────
function CreateInvoiceView({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({
    customerName: "",
    customerPhone: "",
    serviceDescription: "",
    vehicleInfo: "",
    totalAmount: "",
    partsCost: "",
    laborCost: "",
    taxAmount: "",
    paymentMethod: "card",
    paymentStatus: "paid",
    invoiceNumber: "",
    invoiceDate: new Date().toISOString().split("T")[0],
  });

  const createInvoice = trpc.invoices.create.useMutation({
    onSuccess: () => {
      toast.success("Invoice created");
      onDone();
    },
    onError: (err: { message: string }) => toast.error(err.message),
  });

  const handleSubmit = () => {
    if (!form.customerName.trim()) { toast.error("Customer name is required"); return; }
    if (!form.totalAmount) { toast.error("Total amount is required"); return; }
    createInvoice.mutate({
      customerName: form.customerName,
      customerPhone: form.customerPhone || undefined,
      serviceDescription: form.serviceDescription || undefined,
      vehicleInfo: form.vehicleInfo || undefined,
      totalAmount: Math.round(parseFloat(form.totalAmount) * 100),
      partsCost: form.partsCost ? Math.round(parseFloat(form.partsCost) * 100) : 0,
      laborCost: form.laborCost ? Math.round(parseFloat(form.laborCost) * 100) : 0,
      taxAmount: form.taxAmount ? Math.round(parseFloat(form.taxAmount) * 100) : 0,
      paymentMethod: form.paymentMethod as "card" | "cash" | "check" | "financing" | "other",
      paymentStatus: form.paymentStatus as "paid" | "pending" | "partial" | "refunded",
      invoiceNumber: form.invoiceNumber || undefined,
      invoiceDate: form.invoiceDate,
      source: "manual",
    });
  };

  return (
    <div className="max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-[15px] font-semibold text-foreground tracking-tight">New invoice</h3>
        <button onClick={onDone} aria-label="Close" className="text-foreground/40 hover:text-foreground">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Customer Name *" value={form.customerName} onChange={(v) => setForm(f => ({ ...f, customerName: v }))} placeholder="John Smith" />
          <FormField label="Phone" value={form.customerPhone} onChange={(v) => setForm(f => ({ ...f, customerPhone: v }))} placeholder={BUSINESS.phone.placeholder} type="tel" inputMode="tel" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <FormField label="Vehicle" value={form.vehicleInfo} onChange={(v) => setForm(f => ({ ...f, vehicleInfo: v }))} placeholder="2019 Honda Civic" />
          <FormField label="Invoice #" value={form.invoiceNumber} onChange={(v) => setForm(f => ({ ...f, invoiceNumber: v }))} placeholder="INV-001" />
        </div>
        <FormField label="Service Description" value={form.serviceDescription} onChange={(v) => setForm(f => ({ ...f, serviceDescription: v }))} placeholder="Brake pad replacement, rotor resurfacing" />

        <div className="grid grid-cols-4 gap-4">
          <FormField label="Parts ($)" value={form.partsCost} onChange={(v) => setForm(f => ({ ...f, partsCost: v }))} placeholder="0.00" type="number" inputMode="decimal" />
          <FormField label="Labor ($)" value={form.laborCost} onChange={(v) => setForm(f => ({ ...f, laborCost: v }))} placeholder="0.00" type="number" inputMode="decimal" />
          <FormField label="Tax ($)" value={form.taxAmount} onChange={(v) => setForm(f => ({ ...f, taxAmount: v }))} placeholder="0.00" type="number" inputMode="decimal" />
          <FormField label="Total ($) *" value={form.totalAmount} onChange={(v) => setForm(f => ({ ...f, totalAmount: v }))} placeholder="0.00" type="number" inputMode="decimal" />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-[11px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-1.5">Payment Method</label>
            <select value={form.paymentMethod} onChange={(e) => setForm(f => ({ ...f, paymentMethod: e.target.value as typeof f.paymentMethod }))} className="w-full bg-background border border-border/30 px-3 py-2 text-[12px] text-foreground">
              <option value="card">Card</option>
              <option value="cash">Cash</option>
              <option value="check">Check</option>
              <option value="financing">Financing</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-1.5">Status</label>
            <select value={form.paymentStatus} onChange={(e) => setForm(f => ({ ...f, paymentStatus: e.target.value as typeof f.paymentStatus }))} className="w-full bg-background border border-border/30 px-3 py-2 text-[12px] text-foreground">
              <option value="paid">Paid</option>
              <option value="pending">Pending</option>
              <option value="partial">Partial</option>
              <option value="refunded">Refunded</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-1.5">Date</label>
            <input type="date" value={form.invoiceDate} onChange={(e) => setForm(f => ({ ...f, invoiceDate: e.target.value }))} className="w-full bg-background border border-border/30 px-3 py-2 text-[12px] text-foreground" />
          </div>
        </div>

        <div className="flex items-center gap-3 pt-4">
          <button
            onClick={handleSubmit}
            disabled={createInvoice.isPending}
            className="px-6 py-2.5 bg-primary text-primary-foreground font-bold text-sm tracking-wider hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {createInvoice.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "CREATE INVOICE"}
          </button>
          <button onClick={onDone} className="px-6 py-2.5 border border-border/30 text-foreground/60 font-bold text-sm tracking-wider hover:text-foreground transition-colors">
            CANCEL
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── FORM FIELD ─────────────────────────────────────────
// wave-119 — added inputMode prop for proper iOS keyboard hints. Without
// it, type="number" shows a numpad with no decimal key (bad for $) and
// type="text" shows full QWERTY (bad for phone). Pass inputMode="decimal"
// for money, "tel" for phone, "numeric" for integers.
function FormField({ label, value, onChange, placeholder, type = "text", inputMode }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  inputMode?: "text" | "tel" | "decimal" | "numeric" | "email" | "url" | "search";
}) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-[0.15em] text-foreground/50 font-medium mb-1.5">{label}</label>
      <input
        type={type}
        inputMode={inputMode}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-background border border-border/30 px-3 py-2 text-[12px] text-foreground placeholder:text-foreground/20 focus:border-primary/50 focus:outline-none"
      />
    </div>
  );
}

// ─── KPI CARD ───────────────────────────────────────────
function KPICard({ label, value, icon, trend, trendLabel, color = "text-foreground" }: {
  label: string; value: string | number; icon: React.ReactNode; trend?: number; trendLabel?: string; color?: string;
}) {
  return (
    <div className="glow-on-hover bg-card border border-border/30 p-5">
      <div className="flex items-start justify-between mb-3">
        <span className="text-[11px] uppercase tracking-[0.15em] text-foreground/50 font-medium">{label}</span>
        <div className="text-foreground/30">{icon}</div>
      </div>
      <div className={`font-bold text-3xl tracking-tight ${color}`}>{value}</div>
      {trendLabel && (
        <div className={`mt-2 flex items-center gap-1 text-[10px] tracking-wider ${
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
      <span className="text-[10px] uppercase tracking-[0.12em] text-foreground/45 font-medium block">{label}</span>
      <span className={`font-bold text-2xl ${alert ? "text-red-400" : "text-foreground"}`}>{value}</span>
      <span className="font-mono text-[9px] text-foreground/30 ml-1">{sub}</span>
    </div>
  );
}
