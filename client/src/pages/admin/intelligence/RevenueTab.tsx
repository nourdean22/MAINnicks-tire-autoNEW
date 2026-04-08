import { trpc } from "@/lib/trpc";
import { BUSINESS } from "@shared/business";
import { StatCard } from "../shared";
import { SectionSpinner, NoData, EngineCard, MiniTable, fmt, pct, STALE_TIME } from "./utils";

const MONTHLY_TARGET = BUSINESS.revenueTarget.monthly;
import {
  DollarSign, BarChart3, Target, TrendingUp, TrendingDown, Minus,
  AlertTriangle, CreditCard, Activity,
} from "lucide-react";

export default function RevenueTab() {
  const forecast = trpc.intelligence.forecast.useQuery(undefined, { staleTime: STALE_TIME });
  const anomaly = trpc.intelligence.revenueAnomaly.useQuery(undefined, { staleTime: STALE_TIME });
  const cashFlow = trpc.intelligence.cashFlow.useQuery(undefined, { staleTime: STALE_TIME });
  const margins = trpc.intelligence.profitMargins.useQuery(undefined, { staleTime: STALE_TIME });
  const ticket = trpc.intelligence.ticketTrend.useQuery(undefined, { staleTime: STALE_TIME });
  const concentration = trpc.intelligence.revenueConcentration.useQuery(undefined, { staleTime: STALE_TIME });
  const payments = trpc.intelligence.paymentTrends.useQuery(undefined, { staleTime: STALE_TIME });

  return (
    <div className="space-y-6">
      {/* Forecast KPIs */}
      {forecast.isLoading ? <SectionSpinner /> : forecast.data ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="TODAY SO FAR"
              value={fmt(forecast.data.today?.soFar ?? 0)}
              icon={<DollarSign className="w-4 h-4" />}
              color={forecast.data.today?.pct >= 80 ? "text-emerald-400" : forecast.data.today?.pct >= 50 ? "text-amber-400" : "text-red-400"}
              trendLabel={`${forecast.data.today?.pct ?? 0}% of ${fmt(forecast.data.today?.expected ?? 0)}`}
              trend={forecast.data.today?.pct >= 80 ? "up" : "down"}
            />
            <StatCard
              label="WEEK PROJECTION"
              value={fmt(forecast.data.week?.projection ?? 0)}
              icon={<BarChart3 className="w-4 h-4" />}
              trendLabel={`${fmt(forecast.data.week?.soFar ?? 0)} earned`}
              trend="neutral"
            />
            <StatCard
              label="MONTH PROJECTION"
              value={fmt(forecast.data.month?.projection ?? 0)}
              icon={<Target className="w-4 h-4" />}
              color={forecast.data.month?.onPace ? "text-emerald-400" : "text-red-400"}
              trendLabel={forecast.data.month?.onPace ? "On pace" : `${fmt(Math.abs(forecast.data.month?.gap ?? 0))} behind`}
              trend={forecast.data.month?.onPace ? "up" : "down"}
            />
            <StatCard
              label="TREND"
              value={(forecast.data.trend || "flat").toUpperCase()}
              icon={forecast.data.trend === "up" ? <TrendingUp className="w-4 h-4" /> : forecast.data.trend === "down" ? <TrendingDown className="w-4 h-4" /> : <Minus className="w-4 h-4" />}
              color={forecast.data.trend === "up" ? "text-emerald-400" : forecast.data.trend === "down" ? "text-red-400" : "text-foreground/50"}
            />
          </div>

          {/* Progress bar */}
          <div className="bg-card border border-border/30 p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-medium text-foreground/50 tracking-wide">MONTH VS {BUSINESS.revenueTarget.display} TARGET</span>
              <span className="text-[12px] font-mono text-foreground/70">{fmt(forecast.data.month?.soFar ?? 0)} / {BUSINESS.revenueTarget.display}</span>
            </div>
            <div className="w-full h-3 bg-background rounded-sm overflow-hidden">
              <div
                className={`h-full transition-all duration-700 rounded-sm ${forecast.data.month?.onPace ? "bg-emerald-500" : "bg-red-500"}`}
                style={{ width: `${Math.min(100, Math.round(((forecast.data.month?.soFar ?? 0) / MONTHLY_TARGET) * 100))}%` }}
              />
            </div>
          </div>
        </>
      ) : <NoData />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Revenue Anomaly — {anomalies: {date, revenue, expected, deviation, type}[], avgDailyRevenue} */}
        {anomaly.isLoading ? <SectionSpinner /> : anomaly.data ? (
          <EngineCard title="REVENUE ANOMALIES" icon={<AlertTriangle className="w-4 h-4 text-amber-400" />} border={anomaly.data.anomalies?.length > 0 ? "border-amber-500/20" : "border-border/30"}>
            <div className="text-[12px] text-foreground/50 mb-3">Avg daily: <span className="font-mono font-bold text-foreground">{fmt(anomaly.data.avgDailyRevenue)}</span></div>
            {anomaly.data.anomalies?.length > 0 ? (
              <MiniTable
                headers={["DATE", "REVENUE", "EXPECTED", "TYPE"]}
                rows={anomaly.data.anomalies.slice(0, 6).map((a: any) => [
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
                rows={margins.data.byService.slice(0, 8).map((s: any) => [
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
                rows={payments.data.methods.map((m: any) => [
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
        {/* Ticket Trend — {monthly: {month, avgTicket, jobCount}[], trend, percentChange} */}
        {ticket.isLoading ? <SectionSpinner /> : ticket.data ? (
          <EngineCard title="AVG TICKET TREND" icon={<TrendingUp className="w-4 h-4 text-primary" />}>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="text-center">
                <div className={`text-xl font-bold font-mono ${ticket.data.trend === "increasing" ? "text-emerald-400" : ticket.data.trend === "decreasing" ? "text-red-400" : "text-foreground"}`}>
                  {ticket.data.trend.toUpperCase()}
                </div>
                <div className="text-[10px] text-foreground/40">DIRECTION</div>
              </div>
              <div className="text-center">
                <div className={`text-xl font-bold font-mono ${ticket.data.percentChange >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {ticket.data.percentChange >= 0 ? "+" : ""}{ticket.data.percentChange}%
                </div>
                <div className="text-[10px] text-foreground/40">CHANGE</div>
              </div>
            </div>
            {ticket.data.monthly?.length > 0 && (
              <div className="space-y-1">
                {ticket.data.monthly.slice(-6).map((m: any, i: number) => (
                  <div key={i} className="flex items-center justify-between py-1 text-[12px]">
                    <span className="text-foreground/60 font-mono">{m.month}</span>
                    <div className="flex items-center gap-4">
                      <span className="font-mono text-foreground">{fmt(m.avgTicket)}</span>
                      <span className="font-mono text-foreground/40">{m.jobCount} jobs</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </EngineCard>
        ) : null}

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
    </div>
  );
}
