/**
 * Traffic → Revenue Funnel Dashboard
 *
 * The diagnostic screen that makes conversion leaks obvious at a glance.
 *
 * Layout:
 *  - Range toggle (7d / 30d / 90d)
 *  - Funnel bars: each stage as a shrinking bar with count + conversion %
 *    (red bar when conversion rate is critically low)
 *  - Alert panel: hard-coded diagnostic rules (dead call tracking, forms
 *    not converting, mostly-branded traffic, etc.)
 *  - Top queries + top landing pages
 *  - Branded vs non-branded split donut
 *
 * Data source: trpc.trafficFunnel.overview — see server/routers/trafficFunnel.ts
 */

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { PageHeader } from "./shared";
import {
  Loader2, TrendingUp, AlertTriangle, AlertCircle, Info,
  ExternalLink, Zap, Eye, MousePointer, MessageSquare, Calendar, DollarSign,
  Search, Image as ImageIcon, Activity,
} from "lucide-react";

type Range = "7d" | "30d" | "90d";

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(0)}k`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function severityColors(sev: "good" | "warn" | "critical") {
  return {
    good: { bar: "bg-emerald-500/80", text: "text-emerald-400", bg: "bg-emerald-500/5", border: "border-emerald-500/20" },
    warn: { bar: "bg-amber-500/80", text: "text-amber-400", bg: "bg-amber-500/5", border: "border-amber-500/20" },
    critical: { bar: "bg-red-500/80", text: "text-red-400", bg: "bg-red-500/5", border: "border-red-500/20" },
  }[sev];
}

function stageIcon(key: string): React.ReactNode {
  const map: Record<string, React.ReactNode> = {
    impressions: <Eye className="w-4 h-4" />,
    clicks: <MousePointer className="w-4 h-4" />,
    engaged: <MessageSquare className="w-4 h-4" />,
    bookings: <Calendar className="w-4 h-4" />,
    invoices: <DollarSign className="w-4 h-4" />,
  };
  return map[key] ?? <Zap className="w-4 h-4" />;
}

export default function TrafficFunnelSection() {
  const [range, setRange] = useState<Range>("30d");
  const { data, isLoading, error, refetch, isFetching } = trpc.trafficFunnel.overview.useQuery(
    { range },
    { refetchInterval: 60_000 },
  );

  const maxCount = useMemo(() => {
    if (!data) return 1;
    return Math.max(...data.stages.map((s) => s.count), 1);
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-red-500/5 border border-red-500/20 p-5 text-red-400 text-sm">
        Failed to load funnel data: {error?.message ?? "unknown"}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Traffic → Revenue Funnel"
        subtitle="From Google search to paid invoice. Each stage shows raw count + conversion from the one above."
        icon={<TrendingUp className="w-6 h-6" />}
        actions={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-card border border-border/30 rounded p-0.5">
              {(["7d", "30d", "90d"] as Range[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRange(r)}
                  className={`px-3 py-1 text-[11px] font-semibold tracking-wide rounded transition-all ${
                    range === r
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground/50 hover:text-foreground"
                  }`}
                >
                  {r.toUpperCase()}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => refetch()}
              disabled={isFetching}
              className="px-3 py-1.5 text-[11px] text-foreground/60 hover:text-foreground bg-card border border-border/30 rounded transition-all disabled:opacity-50"
            >
              {isFetching ? "…" : "Refresh"}
            </button>
          </div>
        }
      />

      {/* ─── ALERTS ─────────────────────────────────────── */}
      {data.alerts.length > 0 && (
        <div className="space-y-2">
          {data.alerts.map((a, idx) => {
            const icon = a.level === "critical" ? <AlertTriangle className="w-4 h-4 shrink-0" />
              : a.level === "warning" ? <AlertCircle className="w-4 h-4 shrink-0" />
              : <Info className="w-4 h-4 shrink-0" />;
            const cls = a.level === "critical" ? "bg-red-500/5 border-red-500/20 text-red-400"
              : a.level === "warning" ? "bg-amber-500/5 border-amber-500/20 text-amber-400"
              : "bg-blue-500/5 border-blue-500/20 text-blue-400";
            return (
              <div key={idx} className={`flex items-start gap-3 p-4 border ${cls}`}>
                {icon}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm tracking-wide uppercase">{a.title}</div>
                  <p className="text-[13px] text-foreground/80 mt-1 leading-relaxed">{a.detail}</p>
                  {a.fix && (
                    <p className="text-[11px] text-foreground/60 mt-2 italic">
                      <span className="font-semibold text-foreground/80">Fix:</span> {a.fix}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ─── FUNNEL BARS ────────────────────────────────── */}
      <div className="bg-card border border-border/30 p-5">
        <h3 className="text-xs font-semibold text-foreground/60 tracking-wide uppercase mb-5 flex items-center gap-2">
          <TrendingUp className="w-3.5 h-3.5" />
          The Funnel · last {data.days} days
        </h3>
        <div className="space-y-4">
          {data.stages.map((stage, idx) => {
            const widthPct = Math.max((stage.count / maxCount) * 100, 2);
            const colors = severityColors(stage.severity);
            const isFirst = idx === 0;
            return (
              <div key={stage.key} className="relative">
                {/* Conversion chip from previous stage */}
                {!isFirst && stage.conversionFromPrev != null && (
                  <div className={`absolute -top-3 left-6 text-[10px] font-mono font-bold px-2 py-0.5 rounded-full z-10 ${
                    stage.conversionFromPrev >= 5 ? "bg-emerald-500/20 text-emerald-400"
                    : stage.conversionFromPrev >= 1 ? "bg-amber-500/20 text-amber-400"
                    : "bg-red-500/20 text-red-400"
                  }`}>
                    ↓ {stage.conversionFromPrev}%
                  </div>
                )}
                <div className="flex items-center gap-4">
                  <div className={`flex items-center gap-2 w-48 shrink-0 ${colors.text}`}>
                    {stageIcon(stage.key)}
                    <span className="text-[12px] font-semibold tracking-wide uppercase">{stage.label}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="relative h-10 bg-background/40 rounded overflow-hidden">
                      <div
                        className={`absolute inset-y-0 left-0 ${colors.bar} transition-all duration-500 ease-out flex items-center px-3`}
                        style={{ width: `${widthPct}%` }}
                      >
                        <span className="font-bold text-foreground text-sm tracking-tight">
                          {formatNumber(stage.count)}
                        </span>
                      </div>
                    </div>
                    {stage.sub && (
                      <p className="text-[10px] text-foreground/50 mt-1 ml-1">{stage.sub}</p>
                    )}
                  </div>
                </div>
                {stage.note && (
                  <p className={`text-[11px] mt-1 ml-52 italic ${colors.text}`}>
                    → {stage.note}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── GRID: queries + pages + branded split ──────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Top Queries */}
        <div className="bg-card border border-border/30 p-5 lg:col-span-2">
          <h3 className="text-xs font-semibold text-foreground/60 tracking-wide uppercase mb-4 flex items-center gap-2">
            <Search className="w-3.5 h-3.5" />
            Top 10 Queries by Clicks
          </h3>
          {data.topQueries.length === 0 ? (
            <p className="text-sm text-foreground/40">No GSC data yet in this window.</p>
          ) : (
            <div className="space-y-1.5">
              {data.topQueries.map((q, i) => (
                <div key={i} className="flex items-center gap-3 text-[12px] py-1.5 border-b border-border/10 last:border-0">
                  <span className="w-4 text-foreground/30 font-mono text-[10px]">{i + 1}</span>
                  <span className="flex-1 truncate text-foreground/90" title={q.query}>
                    {q.query}
                    {q.branded && <span className="ml-2 text-[9px] uppercase tracking-wider text-amber-400/70 font-semibold">branded</span>}
                  </span>
                  <span className="w-14 text-right font-mono text-foreground font-semibold">{q.clicks}</span>
                  <span className="w-14 text-right font-mono text-foreground/40">{formatNumber(q.impressions)}</span>
                  <span className="w-12 text-right font-mono text-foreground/60">{q.ctr}%</span>
                  <span className={`w-10 text-right font-mono font-semibold ${
                    q.avgPosition <= 3 ? "text-emerald-400"
                    : q.avgPosition <= 10 ? "text-foreground/70"
                    : q.avgPosition <= 20 ? "text-amber-400"
                    : "text-red-400"
                  }`}>
                    #{q.avgPosition}
                  </span>
                </div>
              ))}
              <div className="flex items-center gap-3 text-[9px] pt-2 text-foreground/30 font-mono uppercase tracking-wider">
                <span className="w-4">#</span>
                <span className="flex-1">query</span>
                <span className="w-14 text-right">clicks</span>
                <span className="w-14 text-right">imps</span>
                <span className="w-12 text-right">ctr</span>
                <span className="w-10 text-right">pos</span>
              </div>
            </div>
          )}
        </div>

        {/* Branded split */}
        <div className="bg-card border border-border/30 p-5">
          <h3 className="text-xs font-semibold text-foreground/60 tracking-wide uppercase mb-4 flex items-center gap-2">
            <Zap className="w-3.5 h-3.5" />
            Branded vs Discovery
          </h3>
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-foreground/60">Branded</span>
                <span className="text-[11px] font-mono text-amber-400 font-semibold">{data.branded.branded} clicks</span>
              </div>
              <div className="h-2 bg-background/40 rounded overflow-hidden">
                <div
                  className="h-full bg-amber-500/80 transition-all duration-500"
                  style={{ width: `${data.branded.brandedPct}%` }}
                />
              </div>
              <p className="text-[9px] text-foreground/30 mt-0.5">People who already know your name</p>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-foreground/60">Discovery</span>
                <span className="text-[11px] font-mono text-emerald-400 font-semibold">{data.branded.nonBranded} clicks</span>
              </div>
              <div className="h-2 bg-background/40 rounded overflow-hidden">
                <div
                  className="h-full bg-emerald-500/80 transition-all duration-500"
                  style={{ width: `${100 - data.branded.brandedPct}%` }}
                />
              </div>
              <p className="text-[9px] text-foreground/30 mt-0.5">New customers finding you</p>
            </div>
            <div className="pt-3 border-t border-border/20">
              <p className="text-[10px] text-foreground/50 leading-relaxed">
                <span className="font-bold text-amber-400">{data.branded.brandedPct}%</span> branded
                {data.branded.brandedPct > 60 && " — SEO isn't driving new discovery. Push non-branded pages harder."}
                {data.branded.brandedPct <= 40 && data.branded.nonBranded > 50 && " — strong discovery. SEO is working."}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ─── TOP PAGES ──────────────────────────────────── */}
      <div className="bg-card border border-border/30 p-5">
        <h3 className="text-xs font-semibold text-foreground/60 tracking-wide uppercase mb-4 flex items-center gap-2">
          <ExternalLink className="w-3.5 h-3.5" />
          Top 10 Landing Pages
        </h3>
        {data.topPages.length === 0 ? (
          <p className="text-sm text-foreground/40">No GSC page data yet.</p>
        ) : (
          <div className="space-y-1.5">
            {data.topPages.map((p, i) => {
              const shortPage = p.page.replace(/^https?:\/\/[^/]+/, "") || p.page;
              return (
                <div key={i} className="flex items-center gap-3 text-[12px] py-1.5 border-b border-border/10 last:border-0">
                  <span className="w-4 text-foreground/30 font-mono text-[10px]">{i + 1}</span>
                  <a
                    href={p.page}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 truncate text-foreground/90 hover:text-primary transition-colors"
                    title={p.page}
                  >
                    {shortPage}
                  </a>
                  <span className="w-14 text-right font-mono text-foreground font-semibold">{p.clicks}</span>
                  <span className="w-14 text-right font-mono text-foreground/40">{formatNumber(p.impressions)}</span>
                  <span className="w-12 text-right font-mono text-foreground/60">{p.ctr}%</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ─── CUSTOMER EVENTS PANEL — visual-surface engagement ── */}
      <CustomerEventsPanel range={range} />

      {/* ─── FOOTER ─────────────────────────────────────── */}
      <div className="text-[10px] text-foreground/30 text-center pt-2">
        <p>
          Data generated {new Date(data.generatedAt).toLocaleString()}.
          GSC syncs daily, other sources are live.
        </p>
        <p className="mt-1">
          Call-click events require the <code className="text-foreground/50">/api/call-events</code> tracking endpoint
          + client-side <code className="text-foreground/50">tel:</code> wrapper. If dead, fix that first — it unlocks
          real engagement visibility.
        </p>
      </div>
    </div>
  );
}

/**
 * CustomerEventsPanel — surfaces the customer_events table that's now
 * being populated by the customer-side trackEvent() wiring (PhotoRibbon
 * photo views, sticky-CTA Hold-A-Bay clicks, future scroll-depth
 * milestones, etc.). Two views: per-event totals + top photos.
 */
function CustomerEventsPanel({ range }: { range: Range }) {
  // Map "7d/30d/90d" to numeric days for the tRPC summary
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;

  const { data: summary, isLoading: summaryLoading } = trpc.customerEvents.summary.useQuery(
    { days },
    { refetchInterval: 60_000 },
  );
  const { data: topPhotos, isLoading: photosLoading } = trpc.customerEvents.topRibbonPhotos.useQuery(
    { days, limit: 10 },
    { refetchInterval: 60_000 },
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="text-[#FDB913] text-[10px] font-mono uppercase tracking-widest mb-1">
            Customer-Side Events ({range})
          </div>
          <h3 className="font-bold text-base text-foreground tracking-wide uppercase">
            Visual Surface Engagement
          </h3>
          <p className="text-[12px] text-foreground/40 mt-1 max-w-2xl">
            PhotoRibbon photo views, sticky-CTA "Hold a Bay" clicks, and
            anything else fired through trackEvent() on the customer
            site. Best for tuning which photos drive engagement and
            verifying the new visual surfaces are actually being used.
          </p>
        </div>
      </div>

      {/* Per-event totals + top photos side-by-side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Per-event totals */}
        <div className="bg-card border border-border/30 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-foreground/40" />
            <h4 className="text-xs font-bold tracking-wider uppercase text-foreground/60">
              Event Totals
            </h4>
          </div>
          {summaryLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
            </div>
          ) : !summary || summary.totals.length === 0 ? (
            <div className="text-[12px] text-foreground/40 py-6 text-center">
              No events yet in this window. Live the day after the
              customer_events migration runs and the new tracking
              fires from the public site.
            </div>
          ) : (
            <div className="space-y-1.5">
              {summary.totals.map((t: { eventName: string; count: number }) => (
                <div
                  key={t.eventName}
                  className="flex items-center justify-between text-[13px] py-1.5 border-b border-border/10 last:border-0"
                >
                  <code className="text-foreground/80 font-mono text-[11px]">
                    {t.eventName}
                  </code>
                  <span className="font-mono font-bold text-foreground tabular-stat">
                    {t.count.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top PhotoRibbon photos */}
        <div className="bg-card border border-border/30 p-4">
          <div className="flex items-center gap-2 mb-3">
            <ImageIcon className="w-4 h-4 text-foreground/40" />
            <h4 className="text-xs font-bold tracking-wider uppercase text-foreground/60">
              Top PhotoRibbon Photos
            </h4>
          </div>
          {photosLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
            </div>
          ) : !topPhotos || topPhotos.length === 0 ? (
            <div className="text-[12px] text-foreground/40 py-6 text-center">
              No ribbon photo views yet. Will populate after customers
              start scrolling through PhotoRibbon on Home / Brakes /
              Tires / Diagnostics.
            </div>
          ) : (
            <div className="space-y-2">
              {topPhotos.map((p: { src: string; count: number }, i: number) => {
                const max = topPhotos[0]?.count || 1;
                const pct = (p.count / max) * 100;
                const filename = (p.src || "").split("/").pop() || p.src;
                return (
                  <div key={p.src} className="relative">
                    <div className="flex items-center gap-3 text-[12px] py-1">
                      <span className="w-5 text-foreground/30 font-mono text-[10px] shrink-0">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="flex-1 min-w-0 truncate text-foreground/80 font-mono text-[10px]">
                        {filename}
                      </span>
                      <span className="font-mono font-bold text-foreground/90 tabular-stat shrink-0">
                        {p.count.toLocaleString()}
                      </span>
                    </div>
                    <div
                      className="absolute left-8 right-12 bottom-0 h-0.5 bg-primary/40"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Recent events live tail */}
      {summary && summary.recent.length > 0 && (
        <div className="bg-card border border-border/30 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-4 h-4 text-foreground/40" />
            <h4 className="text-xs font-bold tracking-wider uppercase text-foreground/60">
              Live Tail (Last 50)
            </h4>
          </div>
          <div className="max-h-72 overflow-y-auto space-y-0.5 text-[11px] font-mono">
            {summary.recent.map((r: { id: number; eventName: string; sourcePage: string | null; createdAt: string | Date }) => (
              <div
                key={r.id}
                className="flex items-center gap-3 py-1 border-b border-border/5 last:border-0"
              >
                <span className="text-foreground/30 shrink-0 w-24 truncate">
                  {new Date(r.createdAt).toLocaleString(undefined, { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" })}
                </span>
                <code className="text-foreground/70 shrink-0 w-44 truncate">
                  {r.eventName}
                </code>
                <span className="text-foreground/40 truncate">
                  {r.sourcePage}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

