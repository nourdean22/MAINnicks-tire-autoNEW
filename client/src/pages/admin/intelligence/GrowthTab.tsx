import { trpc } from "@/lib/trpc";
import { StatCard } from "../shared";
import { SectionSpinner, NoData, EngineCard, MiniTable, fmt, pct, STALE_TIME } from "./utils";
import {
  TrendingUp, Users, Heart, Globe, Calendar, MapPin, Layers,
} from "lucide-react";

export default function GrowthTab() {
  const velocity = trpc.intelligence.customerVelocity.useQuery(undefined, { staleTime: STALE_TIME });
  const referral = trpc.intelligence.referralNetwork.useQuery(undefined, { staleTime: STALE_TIME });
  const portfolio = trpc.intelligence.portfolioLTV.useQuery(undefined, { staleTime: STALE_TIME });
  const market = trpc.intelligence.marketShare.useQuery(undefined, { staleTime: STALE_TIME });
  const seasonal = trpc.intelligence.seasonalDemand.useQuery(undefined, { staleTime: STALE_TIME });
  const geo = trpc.intelligence.geoRevenue.useQuery(undefined, { staleTime: STALE_TIME });
  const bundles = trpc.intelligence.serviceBundles.useQuery(undefined, { staleTime: STALE_TIME });

  return (
    <div className="space-y-6">
      {/* Customer Velocity — {thisMonth, lastMonth, velocity, trend, projectedYearEnd} */}
      {velocity.isLoading ? <SectionSpinner /> : velocity.data ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard
            label="NEW THIS MONTH"
            value={velocity.data.thisMonth}
            icon={<Users className="w-4 h-4" />}
            color="text-blue-400"
            trendLabel={`${velocity.data.trend}`}
            trend={velocity.data.trend === "accelerating" ? "up" : velocity.data.trend === "decelerating" ? "down" : "neutral"}
          />
          <StatCard
            label="LAST MONTH"
            value={velocity.data.lastMonth}
            icon={<TrendingUp className="w-4 h-4" />}
            trendLabel="previous month"
            trend="neutral"
          />
          <StatCard
            label="VELOCITY"
            value={velocity.data.velocity}
            icon={<TrendingUp className="w-4 h-4" />}
            trendLabel="monthly rate"
            trend="neutral"
          />
          <StatCard
            label="YEAR-END PROJ."
            value={velocity.data.projectedYearEnd}
            icon={<TrendingUp className="w-4 h-4" />}
            color="text-emerald-400"
            trendLabel="projected total"
            trend="neutral"
          />
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Referral Network — {topReferrers: {name, phone, referralCount, convertedCount, totalRevenue}[], networkSize, avgReferralValue} */}
        {referral.isLoading ? <SectionSpinner /> : referral.data ? (
          <EngineCard title="TOP REFERRERS" icon={<Heart className="w-4 h-4 text-pink-400" />}>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="text-center">
                <div className="text-lg font-bold text-foreground font-mono">{referral.data.networkSize}</div>
                <div className="text-[10px] text-foreground/40">NETWORK SIZE</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-emerald-400 font-mono">{fmt(referral.data.avgReferralValue)}</div>
                <div className="text-[10px] text-foreground/40">AVG VALUE</div>
              </div>
            </div>
            {referral.data.topReferrers?.length > 0 ? (
              <MiniTable
                headers={["NAME", "REFS", "CONVERTED", "REVENUE"]}
                rows={referral.data.topReferrers.slice(0, 8).map((r: any) => [
                  <span className="text-foreground font-medium">{r.name || "Unknown"}</span>,
                  <span className="font-mono">{r.referralCount}</span>,
                  <span className="font-mono text-emerald-400">{r.convertedCount}</span>,
                  <span className="font-mono">{fmt(r.totalRevenue)}</span>,
                ])}
              />
            ) : <NoData label="No referral data yet" />}
          </EngineCard>
        ) : null}

        {/* Portfolio LTV — {totalProjectedLTV, avgCustomerLTV, ltvBySegment: {segment, count, avgLTV, totalLTV}[], growthRate} */}
        {portfolio.isLoading ? <SectionSpinner /> : portfolio.data ? (
          <EngineCard title="PORTFOLIO LTV FORECAST" icon={<TrendingUp className="w-4 h-4 text-violet-400" />}>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div className="text-center">
                <div className="text-lg font-bold text-foreground font-mono">{fmt(portfolio.data.totalProjectedLTV)}</div>
                <div className="text-[10px] text-foreground/40">TOTAL LTV</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-emerald-400 font-mono">{fmt(portfolio.data.avgCustomerLTV)}</div>
                <div className="text-[10px] text-foreground/40">AVG PER CUST</div>
              </div>
              <div className="text-center">
                <div className={`text-lg font-bold font-mono ${portfolio.data.growthRate >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                  {portfolio.data.growthRate >= 0 ? "+" : ""}{portfolio.data.growthRate}%
                </div>
                <div className="text-[10px] text-foreground/40">GROWTH</div>
              </div>
            </div>
            {portfolio.data.ltvBySegment?.length > 0 && (
              <MiniTable
                headers={["SEGMENT", "COUNT", "AVG LTV", "TOTAL"]}
                rows={portfolio.data.ltvBySegment.map((s: any) => [
                  <span className="text-foreground capitalize font-medium">{s.segment}</span>,
                  <span className="font-mono">{s.count}</span>,
                  <span className="font-mono">{fmt(s.avgLTV)}</span>,
                  <span className="font-mono">{fmt(s.totalLTV)}</span>,
                ])}
              />
            )}
          </EngineCard>
        ) : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Market Share — {ourReviews, totalMarketReviews, estimatedShare, trend} */}
        {market.isLoading ? <SectionSpinner /> : market.data ? (
          <EngineCard title="CLEVELAND MARKET SHARE" icon={<Globe className="w-4 h-4 text-blue-400" />}>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div className="text-center">
                <div className="text-xl font-bold text-primary font-mono">{pct(market.data.estimatedShare)}</div>
                <div className="text-[10px] text-foreground/40">EST. SHARE</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-foreground font-mono">{market.data.ourReviews}</div>
                <div className="text-[10px] text-foreground/40">OUR REVIEWS</div>
              </div>
              <div className="text-center">
                <div className={`text-xl font-bold font-mono ${market.data.trend === "growing" ? "text-emerald-400" : market.data.trend === "declining" ? "text-red-400" : "text-foreground/60"}`}>
                  {market.data.trend.toUpperCase()}
                </div>
                <div className="text-[10px] text-foreground/40">TREND</div>
              </div>
            </div>
            <div className="text-center text-[12px] text-foreground/50">
              Market total: <span className="font-mono font-bold">{market.data.totalMarketReviews}</span> reviews
            </div>
          </EngineCard>
        ) : null}

        {/* Seasonal Demand — {currentMonth, hotServices: {service, lastYearCount, trend}[], upcomingDemand: {service, expectedIncrease, prepAction}[]} */}
        {seasonal.isLoading ? <SectionSpinner /> : seasonal.data ? (
          <EngineCard title="SEASONAL DEMAND" icon={<Calendar className="w-4 h-4 text-amber-400" />}>
            <div className="text-[12px] text-foreground/50 mb-3">Current: <span className="font-medium text-foreground">{seasonal.data.currentMonth}</span></div>
            {seasonal.data.hotServices?.length > 0 && (
              <>
                <div className="text-[10px] text-foreground/40 mb-1">HOT SERVICES</div>
                <div className="space-y-1 mb-3">
                  {seasonal.data.hotServices.slice(0, 4).map((s: any, i: number) => (
                    <div key={i} className="flex items-center justify-between py-1 text-[12px]">
                      <span className="text-foreground/70 capitalize font-medium">{s.service}</span>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-foreground/50">{s.lastYearCount} last yr</span>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${s.trend === "up" || s.trend === "rising" ? "text-emerald-400 bg-emerald-500/10" : "text-foreground/40 bg-foreground/5"}`}>
                          {s.trend.toUpperCase()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {seasonal.data.upcomingDemand?.length > 0 && (
              <>
                <div className="text-[10px] text-foreground/40 mb-1">UPCOMING</div>
                <div className="space-y-1">
                  {seasonal.data.upcomingDemand.slice(0, 3).map((d: any, i: number) => (
                    <div key={i} className="bg-foreground/[0.02] p-2 rounded-sm text-[12px]">
                      <span className="text-foreground font-medium capitalize">{d.service}</span>
                      <span className="text-foreground/40"> -- {d.expectedIncrease}</span>
                      <div className="text-[10px] text-primary mt-0.5">{d.prepAction}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </EngineCard>
        ) : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Geo Revenue — {topZipCodes: {zip, customerCount, totalRevenue, avgTicket}[], growthAreas, underservedAreas} */}
        {geo.isLoading ? <SectionSpinner /> : geo.data ? (
          <EngineCard title="REVENUE BY ZIP CODE" icon={<MapPin className="w-4 h-4 text-amber-400" />}>
            {geo.data.topZipCodes?.length > 0 ? (
              <MiniTable
                headers={["ZIP", "CUSTOMERS", "REVENUE", "AVG TICKET"]}
                rows={geo.data.topZipCodes.slice(0, 8).map((z: any) => [
                  <span className="text-foreground font-mono">{z.zip}</span>,
                  <span className="font-mono text-foreground/60">{z.customerCount}</span>,
                  <span className="font-mono">{fmt(z.totalRevenue)}</span>,
                  <span className="font-mono text-foreground/60">{fmt(z.avgTicket)}</span>,
                ])}
              />
            ) : <NoData />}
            {geo.data.growthAreas?.length > 0 && (
              <div className="mt-3">
                <div className="text-[10px] text-foreground/40 mb-1">GROWTH AREAS (90D)</div>
                <div className="flex flex-wrap gap-2">
                  {geo.data.growthAreas.slice(0, 5).map((a: any) => (
                    <span key={a.zip} className="text-[10px] font-mono bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded">
                      {a.zip} (+{a.newCustomersLast90d})
                    </span>
                  ))}
                </div>
              </div>
            )}
          </EngineCard>
        ) : null}

        {/* Service Bundles — {frequentBundles: {services, count, avgTotal}[], recommendedUpsells: {ifService, thenService, probability}[]} */}
        {bundles.isLoading ? <SectionSpinner /> : bundles.data ? (
          <EngineCard title="FREQUENTLY TOGETHER" icon={<Layers className="w-4 h-4 text-violet-400" />}>
            {bundles.data.frequentBundles?.length > 0 && (
              <>
                <div className="text-[10px] text-foreground/40 mb-2">COMMON BUNDLES</div>
                <div className="space-y-2 mb-4">
                  {bundles.data.frequentBundles.slice(0, 5).map((b: any, i: number) => (
                    <div key={i} className="flex items-center justify-between py-1.5 text-[12px]">
                      <span className="text-foreground font-medium">{(b.services || []).join(" + ")}</span>
                      <div className="flex items-center gap-3 text-foreground/50">
                        <span className="font-mono">{b.count}x</span>
                        <span className="font-mono">{fmt(b.avgTotal)} avg</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
            {bundles.data.recommendedUpsells?.length > 0 && (
              <>
                <div className="text-[10px] text-foreground/40 mb-2">RECOMMENDED UPSELLS</div>
                <div className="space-y-1">
                  {bundles.data.recommendedUpsells.slice(0, 5).map((u: any, i: number) => (
                    <div key={i} className="flex items-center justify-between py-1 text-[12px]">
                      <div className="flex items-center gap-2">
                        <span className="text-primary font-semibold capitalize">{u.ifService}</span>
                        <span className="text-foreground/30">-&gt;</span>
                        <span className="text-foreground font-medium capitalize">{u.thenService}</span>
                      </div>
                      <span className="font-mono text-emerald-400">{u.probability}%</span>
                    </div>
                  ))}
                </div>
              </>
            )}
            {!bundles.data.frequentBundles?.length && !bundles.data.recommendedUpsells?.length && <NoData />}
          </EngineCard>
        ) : null}
      </div>
    </div>
  );
}
