import { trpc } from "@/lib/trpc";
import { SectionSpinner, NoData, EngineCard, MiniTable, fmt, pct, STALE_TIME } from "./utils";
import {
  Target, Star, MessageSquare, Zap, Globe, BarChart3, MessageCircle,
} from "lucide-react";

export default function MarketingTab() {
  const channel = trpc.intelligence.channelROI.useQuery(undefined, { staleTime: STALE_TIME });
  const review = trpc.intelligence.reviewVelocity.useQuery(undefined, { staleTime: STALE_TIME });
  const sms = trpc.intelligence.smsEngagement.useQuery(undefined, { staleTime: STALE_TIME });
  const lead = trpc.intelligence.leadResponseTime.useQuery(undefined, { staleTime: STALE_TIME });
  const content = trpc.intelligence.contentPerformance.useQuery(undefined, { staleTime: STALE_TIME });
  const competitor = trpc.intelligence.competitorGap.useQuery(undefined, { staleTime: STALE_TIME });
  const chat = trpc.intelligence.chatFunnel.useQuery(undefined, { staleTime: STALE_TIME });

  return (
    <div className="space-y-6">
      {/* Channel ROI — {channels: {channel, leads, converted, revenue, cost, roi}[], bestChannel, worstChannel} */}
      {channel.isLoading ? <SectionSpinner /> : channel.data ? (
        <EngineCard title="CHANNEL ROI" icon={<Target className="w-4 h-4 text-primary" />}>
          <div className="text-[12px] text-foreground/50 mb-3">
            Best: <span className="text-emerald-400 font-medium">{channel.data.bestChannel}</span>
            {" | "}Worst: <span className="text-red-400 font-medium">{channel.data.worstChannel}</span>
          </div>
          {channel.data.channels?.length > 0 ? (
            <MiniTable
              headers={["SOURCE", "LEADS", "CONVERTED", "REVENUE"]}
              rows={channel.data.channels.slice(0, 8).map((c: any) => [
                <span className="text-foreground font-medium capitalize">{c.channel}</span>,
                <span className="font-mono">{c.leads}</span>,
                <span className="font-mono text-emerald-400">{c.conversions}</span>,
                <span className="font-mono">{fmt(c.revenue ?? 0)}</span>,
              ])}
            />
          ) : <NoData />}
        </EngineCard>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Review Velocity — {thisMonth, lastMonth, velocity, trend, projectedAnnual} */}
        {review.isLoading ? <SectionSpinner /> : review.data ? (
          <EngineCard title="REVIEW VELOCITY" icon={<Star className="w-4 h-4 text-amber-400" />}>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div className="text-center">
                <div className="text-xl font-bold text-foreground font-mono">{review.data.thisMonth}</div>
                <div className="text-[10px] text-foreground/40">THIS MONTH</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-foreground/60 font-mono">{review.data.lastMonth}</div>
                <div className="text-[10px] text-foreground/40">LAST MONTH</div>
              </div>
              <div className="text-center">
                <div className={`text-xl font-bold font-mono ${review.data.trend === "accelerating" ? "text-emerald-400" : review.data.trend === "decelerating" ? "text-red-400" : "text-foreground/60"}`}>
                  {review.data.velocity}
                </div>
                <div className="text-[10px] text-foreground/40">/MONTH RATE</div>
              </div>
            </div>
            <div className="text-center text-[12px] text-foreground/50">
              Projected annual: <span className="font-bold text-foreground">{review.data.projectedAnnual}</span>
              {" | "}Trend: <span className={`font-medium ${review.data.trend === "accelerating" ? "text-emerald-400" : review.data.trend === "decelerating" ? "text-red-400" : "text-foreground/60"}`}>{review.data.trend}</span>
            </div>
          </EngineCard>
        ) : null}

        {/* SMS Engagement — {byCampaign: {campaign, sent, replies, optOuts, responseRate}[], bestPerforming, optOutRate} */}
        {sms.isLoading ? <SectionSpinner /> : sms.data ? (
          <EngineCard title="SMS ENGAGEMENT" icon={<MessageSquare className="w-4 h-4 text-blue-400" />}>
            <div className="text-[12px] text-foreground/50 mb-3">
              Best: <span className="text-emerald-400 font-medium">{sms.data.bestPerforming}</span>
              {" | "}Opt-out rate: <span className="font-mono">{sms.data.optOutRate}%</span>
            </div>
            {sms.data.byCampaign?.length > 0 ? (
              <MiniTable
                headers={["CAMPAIGN", "SENT", "REPLIES", "RATE"]}
                rows={sms.data.byCampaign.slice(0, 5).map((c: any) => [
                  <span className="text-foreground font-medium">{c.campaign}</span>,
                  <span className="font-mono">{c.sent}</span>,
                  <span className="font-mono text-emerald-400">{c.replies}</span>,
                  <span className="font-mono font-semibold">{c.responseRate}%</span>,
                ])}
              />
            ) : <NoData />}
          </EngineCard>
        ) : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Lead Response Time — {avgMinutes, under5min, under30min, over1hour, conversionBySpeed} */}
        {lead.isLoading ? <SectionSpinner /> : lead.data ? (
          <EngineCard title="SPEED TO LEAD" icon={<Zap className="w-4 h-4 text-amber-400" />}>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="text-center">
                <div className={`text-xl font-bold font-mono ${lead.data.avgMinutes <= 30 ? "text-emerald-400" : lead.data.avgMinutes <= 120 ? "text-amber-400" : "text-red-400"}`}>
                  {lead.data.avgMinutes}m
                </div>
                <div className="text-[10px] text-foreground/40">AVG RESPONSE</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-bold text-foreground font-mono">{lead.data.under5min}</div>
                <div className="text-[10px] text-foreground/40">UNDER 5 MIN</div>
              </div>
            </div>
            <div className="space-y-1 text-[12px]">
              <div className="flex items-center justify-between py-1">
                <span className="text-foreground/60">Under 30min</span>
                <span className="font-mono text-foreground/50">{lead.data.under30min} leads</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-foreground/60">Over 1 hour</span>
                <span className="font-mono text-red-400">{lead.data.over1hour} leads</span>
              </div>
            </div>
            {lead.data.conversionBySpeed?.length > 0 && (
              <div className="mt-3">
                <div className="text-[10px] text-foreground/40 mb-1">CONVERSION BY SPEED</div>
                {lead.data.conversionBySpeed.slice(0, 4).map((b: any, i: number) => (
                  <div key={i} className="flex items-center justify-between py-1 text-[12px]">
                    <span className="text-foreground/60">{b.bucket}</span>
                    <span className="font-mono text-emerald-400">{b.rate}% ({b.converted}/{b.leads})</span>
                  </div>
                ))}
              </div>
            )}
          </EngineCard>
        ) : null}

        {/* Content Performance — {topPages: {page, leads, bookings, conversionRate}[], topReferrers} */}
        {content.isLoading ? <SectionSpinner /> : content.data ? (
          <EngineCard title="CONTENT PERFORMANCE" icon={<Globe className="w-4 h-4 text-emerald-400" />}>
            {content.data.topPages?.length > 0 ? (
              <MiniTable
                headers={["PAGE", "LEADS", "BOOKINGS", "CVR"]}
                rows={content.data.topPages.slice(0, 6).map((p: any) => [
                  <span className="text-foreground font-medium truncate max-w-[180px] block">{p.page}</span>,
                  <span className="font-mono">{p.leads}</span>,
                  <span className="font-mono text-emerald-400">{p.bookings}</span>,
                  <span className={`font-mono font-semibold ${p.conversionRate >= 5 ? "text-emerald-400" : "text-foreground/60"}`}>{pct(p.conversionRate)}</span>,
                ])}
              />
            ) : <NoData />}
          </EngineCard>
        ) : null}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Competitor Gap — {us: {rating, reviewCount, responseRate}, competitors: {name, rating, reviewCount, gap}[], advantage} */}
        {competitor.isLoading ? <SectionSpinner /> : competitor.data ? (
          <EngineCard title="VS COMPETITORS" icon={<BarChart3 className="w-4 h-4 text-red-400" />}>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div className="text-center">
                <div className="text-lg font-bold text-amber-400 font-mono">{competitor.data.us.rating}</div>
                <div className="text-[10px] text-foreground/40">OUR RATING</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-foreground font-mono">{competitor.data.us.reviewCount}</div>
                <div className="text-[10px] text-foreground/40">OUR REVIEWS</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-foreground font-mono">{competitor.data.us.responseRate}%</div>
                <div className="text-[10px] text-foreground/40">RESPONSE RATE</div>
              </div>
            </div>
            {competitor.data.competitors?.length > 0 && (
              <MiniTable
                headers={["COMPETITOR", "REVIEWS", "RATING", "GAP"]}
                rows={competitor.data.competitors.slice(0, 5).map((c: any) => [
                  <span className="text-foreground font-medium">{c.name}</span>,
                  <span className="font-mono">{c.reviewCount}</span>,
                  <span className="font-mono">{c.rating}</span>,
                  <span className="text-foreground/50 text-[10px]">{c.gap}</span>,
                ])}
              />
            )}
            {competitor.data.advantage && (
              <div className="mt-3 bg-primary/5 border border-primary/20 p-3 rounded-sm text-[12px] text-foreground/70">
                {competitor.data.advantage}
              </div>
            )}
          </EngineCard>
        ) : null}

        {/* Chat Funnel — {opened, engaged, sharedInfo, convertedToLead, booked, dropOffStage} */}
        {chat.isLoading ? <SectionSpinner /> : chat.data ? (
          <EngineCard title="CHAT CONVERSION FUNNEL" icon={<MessageCircle className="w-4 h-4 text-blue-400" />}>
            <div className="space-y-3">
              {[
                { label: "Opened", value: chat.data.opened, color: "bg-blue-500" },
                { label: "Engaged", value: chat.data.engaged, color: "bg-violet-500" },
                { label: "Shared Info", value: chat.data.sharedInfo, color: "bg-indigo-500" },
                { label: "Converted to Lead", value: chat.data.convertedToLead, color: "bg-amber-500" },
                { label: "Booked", value: chat.data.booked, color: "bg-emerald-500" },
              ].map((step) => {
                const max = chat.data.opened || 1;
                return (
                  <div key={step.label}>
                    <div className="flex items-center justify-between text-[12px] mb-1">
                      <span className="text-foreground/60">{step.label}</span>
                      <span className="font-mono text-foreground/80">{step.value}</span>
                    </div>
                    <div className="w-full h-2 bg-background rounded-sm overflow-hidden">
                      <div className={`h-full rounded-sm ${step.color}`} style={{ width: `${Math.min(100, (step.value / max) * 100)}%` }} />
                    </div>
                  </div>
                );
              })}
              <div className="text-center text-[12px] text-foreground/50 pt-1">
                Drop-off: <span className="font-medium text-red-400">{chat.data.dropOffStage}</span>
              </div>
            </div>
          </EngineCard>
        ) : null}
      </div>
    </div>
  );
}
