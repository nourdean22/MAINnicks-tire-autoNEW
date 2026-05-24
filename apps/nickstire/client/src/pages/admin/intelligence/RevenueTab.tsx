import { trpc } from "@/lib/trpc";
import { SectionSpinner, NoData, EngineCard, MiniTable, fmt, pct, INTELLIGENCE_QUERY_OPTS } from "./utils";
// wave-181.x Intelligence Dispersal Wave 1 · pruned 6 unused imports
// after deleting Forecast KPI grid + MTD bar + AVG TICKET TREND +
// WeatherImpactCard (BUSINESS · MONTHLY_TARGET · StatCard ·
// BarChart3 · Target · TrendingUp · TrendingDown · Minus · CloudRain).
// `forecast` and `ticket` queries also removed (no consumers left).
// Note · intelligence.forecast + ticketTrend tRPC procedures still
// live server-side; this just removes the dead client subscription.
import { DollarSign, AlertTriangle, CreditCard, Activity } from "lucide-react";

export default function RevenueTab() {
  const anomaly = trpc.intelligence.revenueAnomaly.useQuery(undefined, INTELLIGENCE_QUERY_OPTS);
  const cashFlow = trpc.intelligence.cashFlow.useQuery(undefined, INTELLIGENCE_QUERY_OPTS);
  const margins = trpc.intelligence.profitMargins.useQuery(undefined, INTELLIGENCE_QUERY_OPTS);
  const concentration = trpc.intelligence.revenueConcentration.useQuery(undefined, INTELLIGENCE_QUERY_OPTS);
  const payments = trpc.intelligence.paymentTrends.useQuery(undefined, INTELLIGENCE_QUERY_OPTS);

  return (
    <div className="space-y-6">
      {/* wave-181.x Intelligence Dispersal Wave 1 · Forecast KPI grid
       * (4 tiles: Today So Far · Week Projection · Month Projection ·
       * Trend) AND the MTD progress bar both deleted · MoneyBrief
       * already surfaces today's pacing + month projection + trend
       * inline on the Money page (canonical home for revenue velocity
       * signal). Per dispersal plan §4.1 Bucket A cuts. The
       * intelligence.forecast tRPC procedure stays for sub-report
       * data future briefs may need (operator decision §4.4 #1). */}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Revenue Anomaly — {anomalies: {date, revenue, expected, deviation, type}[], avgDailyRevenue} */}
        {anomaly.isLoading ? <SectionSpinner /> : anomaly.data ? (
          <EngineCard title="REVENUE ANOMALIES" icon={<AlertTriangle className="w-4 h-4 text-amber-400" />} border={anomaly.data.anomalies?.length > 0 ? "border-amber-500/20" : "border-border/30"}>
            <div className="text-[12px] text-foreground/50 mb-3">Avg daily: <span className="font-mono font-bold text-foreground">{fmt(anomaly.data.avgDailyRevenue)}</span></div>
            {anomaly.data.anomalies?.length > 0 ? (
              <MiniTable
                headers={["DATE", "REVENUE", "EXPECTED", "TYPE"]}
                rows={anomaly.data.anomalies.slice(0, 6).map((a) => [
                  <span className="text-foreground/70 font-mono">{a.date}</span>,
                  <span className="font-mono font-bold text-foreground">{fmt(a.revenue)}</span>,
                  <span className="font-mono text-foreground/50">{fmt(a.expected)}</span>,
                  <span className={`text-[10px] font-semibold ${a.type === "spike" ? "text-emerald-400" : "text-red-400"}`}>{a.type?.toUpperCase()}</span>,
                ])}
              />
            ) : <NoData label="No anomalies detected" />}
          </EngineCard>
        ) : null}

        {/* Cash Flow — {next7days: {expectedRevenue, pendingCollections, projectedCash}, next30days: {...}, outstandingAR} */}
        {cashFlow.isLoading ? <SectionSpinner /> : cashFlow.data ? (
          <EngineCard title="CASH FLOW FORECAST" icon={<DollarSign className="w-4 h-4 text-emerald-400" />}>
            <div className="grid grid-cols-2 gap-4 mb-3">
              <div className="bg-foreground/[0.02] p-3 rounded-sm">
                <div className="text-[10px] text-foreground/40 mb-2">7-DAY</div>
                <div className="text-lg font-bold text-foreground font-mono">{fmt(cashFlow.data.next7days.projectedCash)}</div>
                <div className="text-[10px] text-foreground/40 mt-1">
                  Rev: {fmt(cashFlow.data.next7days.expectedRevenue)} + AR: {fmt(cashFlow.data.next7days.pendingCollections)}
                </div>
              </div>
              <div className="bg-foreground/[0.02] p-3 rounded-sm">
                <div className="text-[10px] text-foreground/40 mb-2">30-DAY</div>
                <div className="text-lg font-bold text-foreground font-mono">{fmt(cashFlow.data.next30days.projectedCash)}</div>
                <div className="text-[10px] text-foreground/40 mt-1">
                  Rev: {fmt(cashFlow.data.next30days.expectedRevenue)} + AR: {fmt(cashFlow.data.next30days.pendingCollections)}
                </div>
              </div>
            </div>
            <div className="text-center text-[12px] text-foreground/50">
              Outstanding AR: <span className="font-mono font-bold text-amber-400">{fmt(cashFlow.data.outstandingAR)}</span>
            </div>
          </EngineCard>
        ) : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Profit Margins — {byService: {service, revenue, partsCost, laborCost, margin, marginPercent}[], overallMargin, bestMarginService, worstMarginService} */}
        {margins.isLoading ? <SectionSpinner /> : margins.data ? (
          <EngineCard title="PROFIT MARGINS" icon={<Activity className="w-4 h-4 text-violet-400" />}>
            <div className="text-[12px] text-foreground/50 mb-3">
              Overall: <span className="font-bold text-foreground">{margins.data.overallMargin}%</span>
              {" | "}Best: <span className="text-emerald-400 capitalize">{margins.data.bestMarginService}</span>
              {" | "}Worst: <span className="text-red-400 capitalize">{margins.data.worstMarginService}</span>
            </div>
            {margins.data.byService?.length > 0 ? (
              <MiniTable
                headers={["SERVICE", "REVENUE", "MARGIN %"]}
                rows={margins.data.byService.slice(0, 8).map((s) => [
                  <span className="text-foreground capitalize font-medium">{s.service}</span>,
                  <span className="font-mono">{fmt(s.revenue)}</span>,
                  <span className={`font-mono font-semibold ${s.marginPercent >= 50 ? "text-emerald-400" : s.marginPercent >= 30 ? "text-amber-400" : "text-red-400"}`}>{s.marginPercent}%</span>,
                ])}
              />
            ) : <NoData />}
          </EngineCard>
        ) : null}

        {/* Payment Trends — {methods: {method, count, revenue, percentOfTotal, trend}[], financingGrowth} */}
        {payments.isLoading ? <SectionSpinner /> : payments.data ? (
          <EngineCard title="PAYMENT TRENDS" icon={<CreditCard className="w-4 h-4 text-blue-400" />}>
            <div className="text-[12px] text-foreground/50 mb-3">
              Financing growth: <span className={`font-bold ${payments.data.financingGrowth >= 0 ? "text-emerald-400" : "text-red-400"}`}>{payments.data.financingGrowth >= 0 ? "+" : ""}{payments.data.financingGrowth}%</span>
            </div>
            {payments.data.methods?.length > 0 ? (
              <MiniTable
                headers={["METHOD", "COUNT", "REVENUE", "%", "TREND"]}
                rows={payments.data.methods.map((m) => [
                  <span className="text-foreground/70 capitalize font-medium">{m.method}</span>,
                  <span className="font-mono">{m.count}</span>,
                  <span className="font-mono">{fmt(m.revenue)}</span>,
                  <span className="font-mono text-foreground/50">{pct(m.percentOfTotal)}</span>,
                  <span className={`text-[10px] font-semibold ${m.trend === "growing" ? "text-emerald-400" : m.trend === "declining" ? "text-red-400" : "text-foreground/40"}`}>{m.trend}</span>,
                ])}
              />
            ) : <NoData />}
          </EngineCard>
        ) : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* wave-181.x Intelligence Dispersal Wave 1 · AVG TICKET TREND
         * deleted · MoneyBrief surfaces the same velocity/pacing signal
         * adjacent to today's revenue · single source of truth. Per
         * dispersal plan §4.1 Bucket A cuts. */}

        {/* Revenue Concentration — {top10PercentRevenue, top10PercentCount, totalRevenue, concentrationRatio, risk} */}
        {concentration.isLoading ? <SectionSpinner /> : concentration.data ? (
          <EngineCard title="REVENUE CONCENTRATION" icon={<AlertTriangle className="w-4 h-4 text-amber-400" />}
            border={concentration.data.risk === "high" ? "border-red-500/20" : "border-border/30"}>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div className="text-center">
                <div className="text-lg font-bold font-mono text-foreground">{concentration.data.concentrationRatio}%</div>
                <div className="text-[10px] text-foreground/40">TOP 10% SHARE</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold font-mono text-foreground">{fmt(concentration.data.top10PercentRevenue)}</div>
                <div className="text-[10px] text-foreground/40">TOP 10% REV</div>
              </div>
              <div className="text-center">
                <div className={`text-lg font-bold ${concentration.data.risk === "high" ? "text-red-400" : concentration.data.risk === "medium" ? "text-amber-400" : "text-emerald-400"}`}>
                  {concentration.data.risk.toUpperCase()}
                </div>
                <div className="text-[10px] text-foreground/40">RISK LEVEL</div>
              </div>
            </div>
            <div className="text-center text-[12px] text-foreground/50">
              {concentration.data.top10PercentCount} customers drive {concentration.data.concentrationRatio}% of {fmt(concentration.data.totalRevenue)} total
            </div>
          </EngineCard>
        ) : null}
      </div>

      {/* wave-181.x Intelligence Dispersal Wave 1 · WeatherImpactCard
       * deleted (was 73 LOC at the end of this file). Pure proxy of
       * statenour's autonicksWeather endpoint · weather→revenue
       * correlation is genuinely brain-intelligence and belongs on
       * statenour directly, not mirrored in the shop-ops admin. Per
       * dispersal plan §4.3 "HIGH-confidence → delete" list. The
       * intelligence.autonicksWeather tRPC procedure stays for any
       * other caller that needs the demand multiplier. */}
    </div>
  );
}
