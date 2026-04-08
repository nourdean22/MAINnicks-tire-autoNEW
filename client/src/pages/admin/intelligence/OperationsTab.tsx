import { trpc } from "@/lib/trpc";
import { StatCard } from "../shared";
import { SectionSpinner, NoData, EngineCard, MiniTable, fmt, pct, STALE_TIME } from "./utils";
import {
  Wrench, Clock, Package, BarChart3, AlertTriangle, Gauge,
} from "lucide-react";

export default function OperationsTab() {
  const tech = trpc.intelligence.techEfficiency.useQuery(undefined, { staleTime: STALE_TIME });
  const bay = trpc.intelligence.bayUtilization.useQuery(undefined, { staleTime: STALE_TIME });
  const turnaround = trpc.intelligence.turnaroundTime.useQuery(undefined, { staleTime: STALE_TIME });
  const parts = trpc.intelligence.partsCost.useQuery(undefined, { staleTime: STALE_TIME });
  const capacity = trpc.intelligence.capacityForecast.useQuery(undefined, { staleTime: STALE_TIME });
  const bottlenecks = trpc.intelligence.bottlenecks.useQuery(undefined, { staleTime: STALE_TIME });
  const shopLoad = trpc.intelligence.shopLoad.useQuery(undefined, { staleTime: STALE_TIME });

  return (
    <div className="space-y-6">
      {/* Shop Load KPIs */}
      {shopLoad.isLoading ? <SectionSpinner /> : shopLoad.data ? (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <StatCard
            label="ACTIVE WORK ORDERS"
            value={shopLoad.data.activeWOs}
            icon={<Wrench className="w-4 h-4" />}
            color={shopLoad.data.activeWOs > 8 ? "text-red-400" : shopLoad.data.activeWOs > 4 ? "text-amber-400" : "text-emerald-400"}
            trendLabel="in progress"
          />
          <StatCard
            label="TODAY'S BOOKINGS"
            value={shopLoad.data.todayBookings}
            icon={<BarChart3 className="w-4 h-4" />}
            trendLabel="scheduled today"
            trend="neutral"
          />
          <StatCard
            label="EST. WAIT"
            value={`${shopLoad.data.estimatedWait}m`}
            icon={<Clock className="w-4 h-4" />}
            color={shopLoad.data.estimatedWait > 120 ? "text-red-400" : shopLoad.data.estimatedWait > 60 ? "text-amber-400" : "text-emerald-400"}
            trendLabel="minutes"
          />
        </div>
      ) : null}

      {/* Tech Efficiency — rankings: {name, revenuePerHour, jobsPerDay, comebackRate, score}[] */}
      {tech.isLoading ? <SectionSpinner /> : tech.data ? (
        <EngineCard title="TECH EFFICIENCY RANKINGS" icon={<Wrench className="w-4 h-4 text-primary" />}>
          {tech.data.rankings?.length > 0 ? (
            <MiniTable
              headers={["TECH", "$/HR", "JOBS/DAY", "COMEBACK", "SCORE"]}
              rows={tech.data.rankings.slice(0, 10).map((t: any) => [
                <span className="text-foreground font-medium">{t.name || "Unknown"}</span>,
                <span className="font-mono">{fmt(t.revenuePerHour)}</span>,
                <span className="font-mono">{t.jobsPerDay}</span>,
                <span className={`font-mono ${t.comebackRate > 5 ? "text-red-400" : "text-emerald-400"}`}>{t.comebackRate}%</span>,
                <span className={`font-mono font-bold ${t.score >= 80 ? "text-emerald-400" : t.score >= 50 ? "text-amber-400" : "text-red-400"}`}>{t.score}</span>,
              ])}
            />
          ) : <NoData />}
        </EngineCard>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Bay Utilization — {avgOccupancyRate, peakHours, idleHours, totalBays} */}
        {bay.isLoading ? <SectionSpinner /> : bay.data ? (
          <EngineCard title="BAY UTILIZATION" icon={<Gauge className="w-4 h-4 text-blue-400" />}>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="text-center">
                <div className={`text-xl font-bold font-mono ${bay.data.avgOccupancyRate >= 80 ? "text-red-400" : bay.data.avgOccupancyRate >= 50 ? "text-amber-400" : "text-emerald-400"}`}>
                  {bay.data.avgOccupancyRate}%
                </div>
                <div className="text-[10px] text-foreground/40">OCCUPANCY</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-foreground font-mono">{bay.data.totalBays}</div>
                <div className="text-[10px] text-foreground/40">TOTAL BAYS</div>
              </div>
            </div>
            {bay.data.peakHours?.length > 0 && (
              <div className="mb-2">
                <div className="text-[10px] text-foreground/40 mb-1">PEAK HOURS</div>
                <div className="flex flex-wrap gap-1">
                  {bay.data.peakHours.map((h: number) => (
                    <span key={h} className="text-[10px] font-mono bg-primary/10 text-primary px-2 py-0.5 rounded">{h}:00</span>
                  ))}
                </div>
              </div>
            )}
            {bay.data.idleHours?.length > 0 && (
              <div>
                <div className="text-[10px] text-foreground/40 mb-1">IDLE HOURS</div>
                <div className="flex flex-wrap gap-1">
                  {bay.data.idleHours.map((h: number) => (
                    <span key={h} className="text-[10px] font-mono bg-foreground/5 text-foreground/40 px-2 py-0.5 rounded">{h}:00</span>
                  ))}
                </div>
              </div>
            )}
          </EngineCard>
        ) : null}

        {/* Turnaround — {byService: {service, avgHours, targetHours, onTarget}[], overallAvg} */}
        {turnaround.isLoading ? <SectionSpinner /> : turnaround.data ? (
          <EngineCard title="TURNAROUND TIMES" icon={<Clock className="w-4 h-4 text-amber-400" />}>
            <div className="text-[12px] text-foreground/50 mb-3">Overall avg: <span className="font-mono font-bold text-foreground">{turnaround.data.overallAvg}h</span></div>
            {turnaround.data.byService?.length > 0 ? (
              <MiniTable
                headers={["SERVICE", "AVG", "TARGET", "STATUS"]}
                rows={turnaround.data.byService.slice(0, 8).map((s: any) => [
                  <span className="text-foreground capitalize font-medium">{s.service}</span>,
                  <span className={`font-mono font-semibold ${s.avgHours > s.targetHours ? "text-red-400" : "text-emerald-400"}`}>{s.avgHours}h</span>,
                  <span className="font-mono text-foreground/40">{s.targetHours}h</span>,
                  <span className={`text-[10px] font-semibold ${s.onTarget ? "text-emerald-400" : "text-red-400"}`}>{s.onTarget ? "ON TARGET" : "OVER"}</span>,
                ])}
              />
            ) : <NoData />}
          </EngineCard>
        ) : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Parts Cost — {avgPartsPercent, outliers: {invoiceId, service, partsPercent, totalAmount}[], savingsOpportunity} */}
        {parts.isLoading ? <SectionSpinner /> : parts.data ? (
          <EngineCard title="PARTS COST ANALYSIS" icon={<Package className="w-4 h-4 text-violet-400" />}
            border={parts.data.outliers?.length > 0 ? "border-amber-500/20" : "border-border/30"}>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div className="text-center">
                <div className="text-lg font-bold text-foreground font-mono">{pct(parts.data.avgPartsPercent)}</div>
                <div className="text-[10px] text-foreground/40">AVG PARTS %</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-foreground font-mono">{parts.data.outliers?.length ?? 0}</div>
                <div className="text-[10px] text-foreground/40">OUTLIERS</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-emerald-400 font-mono">{fmt(parts.data.savingsOpportunity)}</div>
                <div className="text-[10px] text-foreground/40">SAVINGS OPP.</div>
              </div>
            </div>
            {parts.data.outliers?.length > 0 && (
              <MiniTable
                headers={["SERVICE", "PARTS %", "TOTAL"]}
                rows={parts.data.outliers.slice(0, 5).map((o: any) => [
                  <span className="text-foreground capitalize">{o.service}</span>,
                  <span className="font-mono text-red-400">{pct(o.partsPercent)}</span>,
                  <span className="font-mono">{fmt(o.totalAmount)}</span>,
                ])}
              />
            )}
          </EngineCard>
        ) : null}

        {/* Capacity Forecast — {tomorrow: {expectedJobs, expectedRevenue, staffingRecommendation}, nextWeek: {expectedJobs, expectedRevenue, busiestDay}} */}
        {capacity.isLoading ? <SectionSpinner /> : capacity.data ? (
          <EngineCard title="CAPACITY FORECAST" icon={<BarChart3 className="w-4 h-4 text-emerald-400" />}>
            <div className="grid grid-cols-2 gap-4 mb-3">
              <div className="bg-foreground/[0.02] p-3 rounded-sm">
                <div className="text-[10px] text-foreground/40 mb-2">TOMORROW</div>
                <div className="text-lg font-bold text-foreground font-mono">{capacity.data.tomorrow.expectedJobs} jobs</div>
                <div className="text-[12px] text-foreground/50 font-mono">{fmt(capacity.data.tomorrow.expectedRevenue)}</div>
              </div>
              <div className="bg-foreground/[0.02] p-3 rounded-sm">
                <div className="text-[10px] text-foreground/40 mb-2">NEXT WEEK</div>
                <div className="text-lg font-bold text-foreground font-mono">{capacity.data.nextWeek.expectedJobs} jobs</div>
                <div className="text-[12px] text-foreground/50 font-mono">{fmt(capacity.data.nextWeek.expectedRevenue)}</div>
                <div className="text-[10px] text-foreground/30 mt-1">Busiest: {capacity.data.nextWeek.busiestDay}</div>
              </div>
            </div>
            {capacity.data.tomorrow.staffingRecommendation && (
              <div className="bg-primary/5 border border-primary/20 p-3 rounded-sm text-[12px] text-foreground/70">
                {capacity.data.tomorrow.staffingRecommendation}
              </div>
            )}
          </EngineCard>
        ) : null}
      </div>

      {/* Bottlenecks */}
      {bottlenecks.isLoading ? <SectionSpinner /> : bottlenecks.data ? (
        <EngineCard title="STAGE BOTTLENECKS" icon={<AlertTriangle className="w-4 h-4 text-amber-400" />}
          border={bottlenecks.data.bottleneck ? "border-amber-500/20" : "border-border/30"}>
          {bottlenecks.data.bottleneck && (
            <div className="bg-amber-500/5 border border-amber-500/20 p-3 rounded-sm mb-3">
              <div className="text-[10px] text-amber-400 font-semibold tracking-wide mb-1">SLOWEST STAGE</div>
              <div className="flex items-center justify-between">
                <span className="text-foreground font-medium text-[13px] capitalize">{bottlenecks.data.bottleneck.stage}</span>
                <span className="text-amber-400 font-mono text-[13px]">{bottlenecks.data.bottleneck.avgHours}h avg</span>
              </div>
            </div>
          )}
          {bottlenecks.data.stageMetrics && (
            <div className="space-y-1">
              {Object.entries(bottlenecks.data.stageMetrics).sort((a: any, b: any) => b[1].avgHours - a[1].avgHours).map(([stage, data]: any) => (
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
        </EngineCard>
      ) : null}
    </div>
  );
}
