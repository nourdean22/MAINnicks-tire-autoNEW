import {
  DollarSign, TrendingUp, BarChart3, Users, Target,
  Calendar, ArrowUpRight, ArrowDownRight,
  Zap, Star, Clock, Activity,
  ArrowRight, AlertTriangle, Wrench, CreditCard,
  MessageSquare, Phone,
} from "lucide-react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip,
  ResponsiveContainer, LineChart, Line, PieChart as RPieChart, Pie, Cell, Legend,
  AreaChart, Area, CartesianGrid,
} from "recharts";
import { CHART_COLORS, CHART_THEME, ClickableRow, RowAction } from "../shared";
import MessageCustomerLink from "@/components/admin/MessageCustomerLink";
import { KPICard } from "./KPICard";
import { MiniKPI } from "./MiniKPI";
import { TireSalesPanel } from "./TireSalesPanel";
import {
  MONTHLY_TARGET,
  formatCents,
  formatDollars,
  type FunnelStage,
  type PaymentBreakdown,
  type TopCustomer,
  type ServiceItem,
  type TopDay,
  type IntelRecommendation,
  type AtRiskWhaleRev,
  type DashboardViewProps,
} from "./revenueFormat";

// ─── DASHBOARD VIEW ─────────────────────────────────────
export function DashboardView({ stats, topCustomers, kpi, shopFloor, funnel, period, setPeriod, intel, intelPeriod, setIntelPeriod, custIntel }: DashboardViewProps) {
  const revenueChange = stats?.periodComparison?.change ?? 0;

  // Monthly pace computation · R10 fix · was `intel.projections.monthlyAvg`
  // (the trailing 3-MONTH monthly AVERAGE) rendered as if it were month-to-
  // date — so "$42,563 / $100,000 · 43%" overstated where THIS month actually
  // stands. Now reads the server's TRUE month-to-date (paid invoices since the
  // 1st, period-independent). Falls back to the 3-mo avg only if the field is
  // absent (older deploy / intel still loading) so the bar never blanks.
  const mtdRevenue = intel?.overview?.monthToDateRevenue;
  const hasMtd = typeof mtdRevenue === "number";
  const monthRevenue = hasMtd ? mtdRevenue : (intel?.projections?.monthlyAvg ?? stats?.totalRevenue ?? 0);
  const monthTarget = MONTHLY_TARGET;
  const pacePercent = monthTarget > 0 ? Math.round((monthRevenue / monthTarget) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* wave-181.x Money Phase 1 · cleanup #3 fix · audit agent caught
       * the AT A GLANCE gradient panel duplicating the KPI grid 35
       * lines below. Today's Revenue / Jobs Closed / Bookings / In
       * Shop Now all reappear as KPICard / MiniKPI tiles. Gradient
       * = decoration without information per FRONTEND-DESIGN.
       * Deleted · KPI grid is canonical · ~30 LOC + ~120px above-
       * the-fold real estate reclaimed. */}

      {/* ═══ MONTHLY PACE ═══ */}
      <div className="bg-card border border-border/30 p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-bold text-foreground/50 tracking-wider">{hasMtd ? "MONTH-TO-DATE PACE" : "MONTHLY RUN-RATE vs TARGET"}</span>
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
            : hasMtd
              ? `${pacePercent}% of monthly target — ${formatDollars(monthTarget - monthRevenue)} to go this month`
              : `Trailing 3-mo avg at ${pacePercent}% of the ${formatDollars(monthTarget)} run-rate target`}
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

      {/* wave-181.x Money Phase 1 · M4 + cleanup #6 fix · was an
       * empty-state block that fired when `!shopFloor` (loading
       * state) OR when zero active work orders. The "No active
       * work orders" message flashed during every dashboard mount
       * before real data arrived (M4). Even when data was zero,
       * the message duplicated what the Shop Pulse tab already
       * shows (cleanup #6). Killed the block · the populated
       * panel below at L319 stays · clarity-gate: empty > fake. */}
      {shopFloor && (shopFloor.active > 0 || shopFloor.totalValueInProgress > 0) && (
        <div className="bg-card border border-primary/20 p-5">
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
              // wave-181.x Money Phase 1 · M2 fix · `||` masks legitimate
              // zero-count (empty funnel). Use `??` for undefined-guard
              // and a separate check for zero so we don't divide by 0.
              const maxCount = funnel.stages[0]?.count ?? 0;
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
                <RechartsTooltip contentStyle={CHART_THEME.tooltip} formatter={(value: any) => [`$${Number(value).toLocaleString()}`, "Revenue"]} />
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
                  <Pie data={stats.revenueByPayment.map((d: PaymentBreakdown) => ({ ...d, name: d.method.toUpperCase() }))} dataKey="amount" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}>
                    {stats.revenueByPayment.map((_: PaymentBreakdown, i: number) => (<Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />))}
                  </Pie>
                  <RechartsTooltip contentStyle={CHART_THEME.tooltip} formatter={(value: any) => [`$${Number(value).toLocaleString()}`, "Revenue"]} />
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
                  <XAxis dataKey="day" tick={{ fontSize: 11, fill: CHART_THEME.axis }} />
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

      {/* wave-181.x Money Phase 1 · ELON cut #2 · audit agent flagged
       * the Hour-of-Day Heatmap as unreadable on mobile (24 micro-bars
       * × `font-mono text-[8px]` labels = ~14px columns at <400px ·
       * 9pt iOS minimum legibility). Day-of-Week heatmap above
       * already covers the actionable scheduling signal (Sundays
       * slow / Saturdays peak). Hour-of-day is academic — operator
       * doesn't reschedule based on it. Cut · -28 LOC · fixes mobile
       * bug at the same time. Data preserved in tRPC query if we
       * ever want to bring it back. */}

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
                  {/* 2026-05-23 · phone was display-only mono text. Now a
                      real tel: anchor so operator can one-tap call from
                      the top-customers leaderboard. */}
                  {c.phone && (
                    <a
                      href={`tel:${c.phone}`}
                      className="font-mono text-[10px] text-foreground/40 ml-2 hover:text-emerald-400 transition-colors"
                      title={`Call ${c.phone}`}
                    >
                      {c.phone}
                    </a>
                  )}
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
            <KPICard label="Unique Customers" value={intel.overview.uniqueCustomers ?? 0} icon={<Users className="w-5 h-5" />} color="text-blue-400" />
            <KPICard label="Active Days" value={intel.overview.activeDays ?? 0} icon={<Calendar className="w-5 h-5" />} color="text-purple-400" />
          </div>

          {/* R3 fix · ALG-imported invoices carry rolled-up totals (laborCost
           * + partsCost ~ 0, serviceDescription generic), so the line-item
           * panels rendered misleading "$81 (0%) / $384 (1%)" and a single
           * "Other" service row. clarity-gate: when the captured split is a
           * tiny fraction of revenue (< 5%), the data is rolled up — HIDE the
           * split panel and show an honest note instead of fake percentages.
           * Same for the service breakdown when it collapses to only "Other".
           * Guards computed from data already in scope. */}
          {(() => {
            const lvp = intel.laborVsParts;
            const capturedSplit = (lvp.laborTotal ?? 0) + (lvp.partsTotal ?? 0);
            const totalRev = intel.overview.totalRevenue ?? 0;
            const splitIsRolledUp = totalRev > 0 && capturedSplit < totalRev * 0.05;
            const svc = intel.serviceBreakdown as ServiceItem[];
            const serviceIsUseless = svc.length > 0 && svc.every((s) => s.category === "Other");
            const bothHidden = splitIsRolledUp && (serviceIsUseless || svc.length === 0);

            return (
              <>
                {bothHidden && (
                  <div className="bg-card border border-border/30 p-4 flex items-start gap-3">
                    <BarChart3 className="w-5 h-5 text-foreground/30 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-bold text-foreground/70">Line-item split unavailable</p>
                      <p className="text-[11px] text-foreground/40 mt-0.5">ALG imports carry rolled-up invoice totals — per-line labor, parts, and service category aren't captured, so the split and category breakdown can't be shown for this period.</p>
                    </div>
                  </div>
                )}

                {!bothHidden && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    {/* Labor vs Parts Split — hidden when rolled-up */}
                    {!splitIsRolledUp ? (
                      <div className="bg-card border border-border/30 p-5">
                        <h3 className="font-bold text-sm text-foreground tracking-[-0.01em] mb-4">LABOR vs PARTS SPLIT</h3>
                        <div className="flex items-center gap-4 mb-4">
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[11px] text-foreground/60">Labor</span>
                              <span className="font-bold text-sm text-blue-400">{formatDollars(lvp.laborTotal)} ({lvp.laborPct}%)</span>
                            </div>
                            <div className="h-3 bg-foreground/5 rounded-sm overflow-hidden">
                              <div className="h-full bg-blue-500/40 rounded-sm" style={{ width: `${lvp.laborPct}%` }} />
                            </div>
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[11px] text-foreground/60">Parts</span>
                              <span className="font-bold text-sm text-emerald-400">{formatDollars(lvp.partsTotal)} ({lvp.partsPct}%)</span>
                            </div>
                            <div className="h-3 bg-foreground/5 rounded-sm overflow-hidden">
                              <div className="h-full bg-emerald-500/40 rounded-sm" style={{ width: `${lvp.partsPct}%` }} />
                            </div>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div className="p-2 rounded border border-border/20">
                            <p className="text-lg font-bold text-blue-400">{lvp.laborOnlyJobs}</p>
                            <p className="text-[9px] text-foreground/40">Labor Only</p>
                          </div>
                          <div className="p-2 rounded border border-border/20">
                            <p className="text-lg font-bold text-emerald-400">{lvp.partsOnlyJobs}</p>
                            <p className="text-[9px] text-foreground/40">Parts Only</p>
                          </div>
                          <div className="p-2 rounded border border-border/20">
                            <p className="text-lg font-bold text-primary">{lvp.bothJobs}</p>
                            <p className="text-[9px] text-foreground/40">Both</p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-card border border-border/30 p-5 flex items-start gap-3">
                        <BarChart3 className="w-5 h-5 text-foreground/30 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-xs font-bold text-foreground/70">Labor vs parts unavailable</p>
                          <p className="text-[11px] text-foreground/40 mt-0.5">ALG imports carry rolled-up totals — per-line labor/parts isn't captured for this period.</p>
                        </div>
                      </div>
                    )}

                    {/* Service Category Breakdown — hidden when only "Other" */}
                    {!serviceIsUseless && svc.length > 0 ? (
                      <div className="bg-card border border-border/30 p-5">
                        <h3 className="font-bold text-sm text-foreground tracking-[-0.01em] mb-4">SERVICE BREAKDOWN</h3>
                        <div className="space-y-2 max-h-[280px] overflow-y-auto">
                          {svc.map((s: ServiceItem, i: number) => {
                            // wave-181.x Money Phase 1 · M2 fix · `||` would mask
                            // legitimate $0-revenue top entry. Use `??` for the
                            // undefined-guard (sorted desc · so [0] is max or 0).
                            const maxRev = svc[0]?.revenue ?? 0;
                            const safeMaxRev = maxRev > 0 ? maxRev : 1;
                            return (
                              <div key={s.category} className="flex items-center gap-3">
                                <span className="text-[10px] text-foreground/60 w-24 truncate">{s.category}</span>
                                <div className="flex-1 h-5 bg-foreground/5 rounded-sm overflow-hidden relative">
                                  <div className="h-full rounded-sm" style={{ width: `${(s.revenue / safeMaxRev) * 100}%`, backgroundColor: CHART_COLORS[i % CHART_COLORS.length], opacity: 0.4 }} />
                                  <span className="absolute right-2 top-0.5 text-[10px] font-bold text-foreground/80">{formatDollars(s.revenue)}</span>
                                </div>
                                <span className="text-[10px] text-foreground/40 w-12 text-right">{s.count} jobs</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <div className="bg-card border border-border/30 p-5 flex items-start gap-3">
                        <BarChart3 className="w-5 h-5 text-foreground/30 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-xs font-bold text-foreground/70">Service breakdown unavailable</p>
                          <p className="text-[11px] text-foreground/40 mt-0.5">ALG imports don't carry per-line service categories — everything rolls up as one line, so a category split can't be shown.</p>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            );
          })()}

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
                      formatter={((value: any, name: string) => [`$${Number(value).toLocaleString()}`, name.charAt(0).toUpperCase() + name.slice(1)]) as any} />
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
                      <XAxis dataKey="day" tick={{ fontSize: 10, fill: CHART_THEME.axis }} tickFormatter={(v: string) => v.slice(0, 3)} />
                      <YAxis tick={{ fontSize: 10, fill: CHART_THEME.axis }} tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}K`} />
                      <RechartsTooltip contentStyle={CHART_THEME.tooltip}
                        formatter={((value: any) => [`$${Number(value).toLocaleString()}`, "Revenue"]) as any} />
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
                      <YAxis type="category" dataKey="category" tick={{ fontSize: 10, fill: CHART_THEME.axis }} width={80} />
                      <RechartsTooltip contentStyle={CHART_THEME.tooltip}
                        formatter={((value: number) => [`$${value.toLocaleString()}`, "Avg Ticket"]) as any} />
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
                      formatter={((value: any, name: string) => [name === "jobs" ? value : `$${value.toLocaleString()}`, name === "jobs" ? "Jobs" : name === "avgTicket" ? "Avg Ticket" : "Revenue"]) as any} />
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
                      formatter={(value: any) => [`$${Number(value).toLocaleString()}`, "Revenue"]} />
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
            {/* wave-181.x Money Phase 1 · cleanup #9 fix · audit agent
             * caught the 4th tile duplicating the 1st (both showed
             * intel.projections.monthlyAvg with slightly different
             * labels). Old comment admitted it · was "replaced the
             * $20K goal gap" but never noticed the dup. Dropped to
             * 3-col grid · -1 tile · cleaner above-the-fold. */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
            <span className="text-[10px] font-normal text-foreground/40 ml-1 normal-case">· all-time (ignores the period above)</span>
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
              <p className="text-2xl font-bold text-red-400">{custIntel.churnRisk.atRisk ?? 0}</p>
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
          {/* At-risk whales · 2026-05-23 · uses ClickableRow + RowAction
              primitives from shared.tsx. Whales are non-clickable rows
              for now (the cust drawer doesn't take name+phone yet —
              future enhancement); inline Call/SMS via RowAction. */}
          {custIntel.atRiskWhales.length > 0 && (
            <div>
              <p className="text-[10px] text-foreground/40 font-bold uppercase mb-2">High-Value Customers Going Quiet</p>
              <div className="space-y-1">
                {custIntel.atRiskWhales.map((w: AtRiskWhaleRev, i: number) => {
                  const phone = (w as AtRiskWhaleRev & { phone?: unknown }).phone;
                  const phoneStr = typeof phone === "string" && phone.length >= 7 ? phone : null;
                  return (
                    <ClickableRow key={i} className="py-1.5 px-2 rounded bg-red-500/5 border border-red-500/10">
                      <span className="text-xs font-medium text-foreground flex-1 truncate">{w.name}</span>
                      <span className="text-xs font-bold text-primary">${w.totalSpent.toLocaleString()}</span>
                      <span className="text-[10px] text-foreground/40 hidden sm:inline">{w.visits} visits</span>
                      <span className="text-[10px] text-red-400 font-bold">{w.daysSince}d ago</span>
                      {phoneStr && (
                        <>
                          <RowAction
                            icon={<Phone className="w-3.5 h-3.5" />}
                            href={`tel:${phoneStr}`}
                            title={`Call ${phoneStr}`}
                            ariaLabel={`Call ${w.name}`}
                            hoverClass="hover:text-emerald-400 hover:bg-emerald-500/10"
                            className="p-1"
                          />
                          <MessageCustomerLink
                            phone={phoneStr}
                            body={`Hi ${w.name.split(" ")[0]}, it's Nick's Tire — checking in. Anything we can help with?`}
                            className="p-1 text-foreground/40 hover:text-blue-400 hover:bg-blue-500/10 rounded transition-all inline-flex items-center"
                            title="Open in-admin SMS chat"
                            ariaLabel={`Send SMS to ${w.name}`}
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                          </MessageCustomerLink>
                        </>
                      )}
                    </ClickableRow>
                  );
                })}
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
            Revenue data populates when invoices are created — either manually, from Auto Labor Guide (ALG) imports, or from Stripe payments.
          </p>
        </div>
      )}
    </div>
  );
}
