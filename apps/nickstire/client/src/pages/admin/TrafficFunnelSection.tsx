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
import { PageHeader, ErrorState } from "./shared";
import { toast } from "sonner";
import {
  Loader2, TrendingUp, AlertTriangle, AlertCircle, Info,
  ExternalLink, Zap, Eye, MousePointer, MessageSquare, Calendar, DollarSign,
  Search, Image as ImageIcon, Activity, Send, CheckCircle2, XCircle,
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

  // SEO fix drafts (phase 4 · GSC Act) — AI-drafted title/meta for buried service
  // pages. Read-only: a human applies the shared/services.ts edit; nothing writes live.
  const seoDrafts = trpc.seoTools.seoFixDrafts.useQuery(undefined, { staleTime: 300_000 });
  const genDrafts = trpc.seoTools.generateSeoFixDrafts.useMutation({
    onSuccess: (r) => {
      toast.success(`Drafted ${r.drafts.length} SEO fix${r.drafts.length === 1 ? "" : "es"}`);
      seoDrafts.refetch();
    },
    onError: (e: { message: string }) => toast.error("Draft failed: " + e.message),
  });

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
      <ErrorState
        message={`Couldn't load funnel data${error?.message ? ` · ${error.message}` : ""}`}
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Traffic → Revenue Funnel"
        subtitle="From Google search to booking. Each stage shows raw count + conversion from the one above."
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

      {/* ─── SEO FIX DRAFTS (buried pages · AI-drafted, human applies) ─── */}
      <div className="border border-border/30 bg-card p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-bold text-sm text-foreground tracking-wide flex items-center gap-2">
              <Search className="w-4 h-4 text-primary" /> SEO FIX DRAFTS
            </h3>
            <p className="text-foreground/50 text-[11px] mt-0.5 max-w-2xl">
              AI-drafted title + meta for buried service pages (high impressions, page 2+). Apply by editing{" "}
              <span className="font-mono">shared/services.ts</span> — nothing is written to the live site.
            </p>
          </div>
          <button
            type="button"
            onClick={() => genDrafts.mutate()}
            disabled={genDrafts.isPending}
            className="flex items-center gap-1.5 border border-primary/30 text-primary bg-primary/5 px-3 py-1.5 text-[11px] font-bold tracking-wide hover:bg-primary/10 disabled:opacity-50"
          >
            {genDrafts.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
            {genDrafts.isPending ? "DRAFTING…" : "DRAFT FIXES"}
          </button>
        </div>

        {seoDrafts.data?.drafts && seoDrafts.data.drafts.length > 0 ? (
          <div className="space-y-3">
            {seoDrafts.data.drafts.map((d) => (
              <div key={d.slug} className="border border-border/20 p-3 space-y-2">
                <div className="flex items-center gap-3 flex-wrap text-[11px]">
                  <span className="font-mono text-primary">{d.page}</span>
                  <span className="text-foreground/40">{formatNumber(d.impressions)} impr · pos {d.position}</span>
                </div>
                <div className="grid gap-2 text-[11px]">
                  <div>
                    <span className="text-foreground/40 uppercase tracking-[0.1em] text-[9px] font-bold">Title</span>
                    <p className="text-foreground/40 line-through">{d.currentTitle}</p>
                    <p className="text-emerald-400 font-medium">{d.proposedTitle} <span className="text-foreground/30">({d.proposedTitle.length})</span></p>
                  </div>
                  <div>
                    <span className="text-foreground/40 uppercase tracking-[0.1em] text-[9px] font-bold">Meta description</span>
                    <p className="text-foreground/40 line-through">{d.currentDescription}</p>
                    <p className="text-emerald-400 font-medium">{d.proposedDescription} <span className="text-foreground/30">({d.proposedDescription.length})</span></p>
                  </div>
                  <p className="text-foreground/50 italic">{d.rationale}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(`metaTitle: ${JSON.stringify(d.proposedTitle)},\nmetaDescription: ${JSON.stringify(d.proposedDescription)},`);
                    toast.success("Copied services.ts snippet");
                  }}
                  className="text-[10px] text-foreground/50 hover:text-foreground underline"
                >
                  Copy services.ts snippet
                </button>
              </div>
            ))}
            {seoDrafts.data.generatedAt && (
              <p className="text-[10px] text-foreground/30">Drafted {new Date(seoDrafts.data.generatedAt).toLocaleString()}</p>
            )}
          </div>
        ) : (
          <p className="text-[11px] text-foreground/40 italic">
            No drafts yet. Click &ldquo;Draft Fixes&rdquo; to generate improved title/meta for the buried pages.
          </p>
        )}
      </div>

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

      {/* Revenue-attribution wave 2026-06 · which pages turn into BOOKED
          jobs (web-form bookings carry landingPage; tire-order + phone
          bookings carry none — the card states its own coverage). */}
      <TopBookingPagesPanel range={range} />

      {/* ─── WEEKLY GSC AUDIT PANEL — CTR + ranking + cannibalization ── */}
      <GscAuditPanel range={range} />

      {/* ─── SITEMAP SUBMISSION PANEL — accelerate Google indexing ── */}
      <SitemapSubmissionPanel />

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
          <div className="text-primary text-[10px] font-mono uppercase tracking-widest mb-1">
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

/**
 * TopBookingPagesPanel — revenue-attribution wave 2026-06.
 * "Which pages turn into booked jobs?" — the closest-to-money question no
 * surface answered. Read-only aggregation over bookings.landingPage
 * (trafficFunnel.topBookingPages, pathname-normalized server-side).
 *
 * HONESTY: only web-form bookings carry landing-page attribution (tire-order
 * auto-bookings + phone bookings carry none) — the coverage line states
 * "N of M bookings carry page attribution" whenever data renders, and the
 * empty state explains the gap instead of showing a hollow chart.
 */
function TopBookingPagesPanel({ range }: { range: Range }) {
  const { data, isLoading } = trpc.trafficFunnel.topBookingPages.useQuery(
    { range },
    { refetchInterval: 120_000 },
  );

  const maxCount = data && data.pages.length > 0 ? data.pages[0].count : 0;

  return (
    <div className="space-y-4">
      <div>
        <div className="text-primary text-[10px] font-mono uppercase tracking-widest mb-1">
          Booking Attribution ({range})
        </div>
        <h3 className="font-bold text-base text-foreground tracking-wide uppercase">
          Top Pages by Bookings
        </h3>
        <p className="text-[12px] text-foreground/40 mt-1 max-w-2xl">
          Which pages customers were on when they booked. Web-form bookings
          only — tire-order and phone bookings carry no page attribution.
        </p>
      </div>

      <div className="bg-card border border-border/30 p-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
          </div>
        ) : !data || data.withAttribution === 0 ? (
          <div className="text-[12px] text-foreground/40 py-6 text-center">
            No bookings with page attribution in this window. Web-form
            bookings started carrying landing-page data when UTM capture
            shipped; tire-order and phone bookings never carry it.
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              {data.pages.map((p: { path: string; count: number }) => (
                <div key={p.path} className="flex items-center gap-3 text-[13px] py-1.5 border-b border-border/10 last:border-0">
                  <code className="text-foreground/80 font-mono text-[11px] w-56 truncate shrink-0">
                    {p.path}
                  </code>
                  <div className="flex-1 h-2 bg-background/60 overflow-hidden rounded-sm">
                    <div
                      className="h-full bg-primary/60"
                      style={{ width: `${maxCount > 0 ? Math.max(4, Math.round((p.count / maxCount) * 100)) : 0}%` }}
                    />
                  </div>
                  <span className="font-mono font-bold text-foreground tabular-stat w-10 text-right shrink-0">
                    {p.count.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
            {/* Mandatory coverage caption — a thin sample must never read as the whole picture. */}
            <p className="text-[11px] text-foreground/35 mt-3">
              {data.withAttribution.toLocaleString()} of {data.totalBookings.toLocaleString()} bookings
              in this window carry page attribution — tire-order and phone bookings carry none.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * SitemapSubmissionPanel — admin button + status board for Google
 * Search Console sitemap submission. Wraps seoTools.submitSitemaps
 * + seoTools.sitemapStatus tRPC routes.
 *
 * One click submits all 4 sitemaps (main, services, locations, images)
 * to GSC for re-crawl. Status table shows per-sitemap last-submitted +
 * indexed-vs-submitted counts so Nour can see each sitemap's Google
 * processing state without leaving admin.
 */
function SitemapSubmissionPanel() {
  const utils = trpc.useUtils();
  const { data: status, isLoading: statusLoading } = trpc.seoTools.sitemapStatus.useQuery(
    undefined,
    { staleTime: 60_000 },
  );
  type SubmitResult = { ok: boolean; authError: string | null; results: Array<{ sitemap: string; ok: boolean; error?: string }> };
  const submitMutation = trpc.seoTools.submitSitemaps.useMutation({
    onSuccess: (res: SubmitResult) => {
      const okCount = res.results.filter((r) => r.ok).length;
      const failCount = res.results.length - okCount;
      if (res.authError) {
        toast.error("GSC auth failed", { description: res.authError });
      } else if (failCount === 0) {
        toast.success(`${okCount} sitemap${okCount === 1 ? "" : "s"} submitted`, {
          description: "Google will re-crawl in 24-72h",
        });
      } else {
        toast.warning(`${okCount} ok · ${failCount} failed`, {
          description: res.results.filter((r) => !r.ok).map((r) => r.error).filter(Boolean).join(" · "),
        });
      }
      utils.seoTools.sitemapStatus.invalidate();
    },
    onError: (err: { message: string }) => {
      toast.error("Submission failed", { description: err.message });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="text-primary text-[10px] font-mono uppercase tracking-widest mb-1">
            Search Console
          </div>
          <h3 className="font-bold text-base text-foreground tracking-wide uppercase">
            Sitemap Submission
          </h3>
          <p className="text-[12px] text-foreground/40 mt-1 max-w-2xl">
            Pings Google to re-crawl the 4 sitemaps. Use after content
            audits, new pages, or when a fresh sitemap-images.xml lands.
            Same JWT-signed service-account flow as the gsc-submit-sitemap
            CLI script — just no SSH required.
          </p>
        </div>
        <button
          onClick={() => submitMutation.mutate(undefined)}
          disabled={submitMutation.isPending}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 text-sm font-bold tracking-wide hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {submitMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
          {submitMutation.isPending ? "Submitting..." : "Submit All Sitemaps"}
        </button>
      </div>

      <div className="bg-card border border-border/30 overflow-hidden">
        {statusLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
          </div>
        ) : !status || !status.ok ? (
          <div className="text-[12px] text-amber-400 p-4">
            {status?.authError
              ? `GSC auth failed: ${status.authError}`
              : "Sitemap status unavailable. Confirm GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_KEY env vars are set, and that the service account has full siteOwner permissions on https://nickstire.org/."}
          </div>
        ) : (
          // wave-120 — wrapped in overflow-x-auto so the 5-column sitemap
          // table can scroll horizontally on phone (390px viewport)
          // instead of squishing or overflowing the parent.
          <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border/20">
                <th className="text-left p-3 text-[10px] text-foreground/40 tracking-widest uppercase">Sitemap</th>
                <th className="text-left p-3 text-[10px] text-foreground/40 tracking-widest uppercase">Last Submitted</th>
                <th className="text-left p-3 text-[10px] text-foreground/40 tracking-widest uppercase">Last Downloaded</th>
                <th className="text-left p-3 text-[10px] text-foreground/40 tracking-widest uppercase">Submitted / Indexed</th>
                <th className="text-left p-3 text-[10px] text-foreground/40 tracking-widest uppercase">State</th>
              </tr>
            </thead>
            <tbody>
              {status.sitemaps.map((s: { url: string; status: { lastSubmitted?: string; lastDownloaded?: string; isPending?: boolean; warnings?: string; errors?: string; contents?: Array<{ type: string; submitted: string; indexed: string }> } | null }) => {
                const filename = s.url.split("/").pop() || s.url;
                const submitted = s.status?.contents?.[0]?.submitted ?? "—";
                const indexed = s.status?.contents?.[0]?.indexed ?? "—";
                const errCount = Number(s.status?.errors ?? 0);
                const warnCount = Number(s.status?.warnings ?? 0);
                const submittedAt = s.status?.lastSubmitted
                  ? new Date(s.status.lastSubmitted).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
                  : "—";
                const downloadedAt = s.status?.lastDownloaded
                  ? new Date(s.status.lastDownloaded).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
                  : "—";
                return (
                  <tr key={s.url} className="border-b border-border/10 last:border-0">
                    <td className="p-3 text-foreground/85 font-mono text-[11px]">{filename}</td>
                    <td className="p-3 text-foreground/55">{submittedAt}</td>
                    <td className="p-3 text-foreground/55">{downloadedAt}</td>
                    <td className="p-3 text-foreground/85 tabular-stat font-mono text-[11px]">{submitted} / {indexed}</td>
                    <td className="p-3">
                      {!s.status ? (
                        <span className="text-foreground/40 text-[11px]">Not yet submitted</span>
                      ) : errCount > 0 ? (
                        <span className="inline-flex items-center gap-1 text-red-400 text-[11px]">
                          <XCircle className="w-3 h-3" /> {errCount} error{errCount === 1 ? "" : "s"}
                        </span>
                      ) : warnCount > 0 ? (
                        <span className="inline-flex items-center gap-1 text-amber-400 text-[11px]">
                          <AlertTriangle className="w-3 h-3" /> {warnCount} warning{warnCount === 1 ? "" : "s"}
                        </span>
                      ) : s.status.isPending ? (
                        <span className="inline-flex items-center gap-1 text-blue-400 text-[11px]">
                          <Loader2 className="w-3 h-3 animate-spin" /> Pending
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-emerald-400 text-[11px]">
                          <CheckCircle2 className="w-3 h-3" /> OK
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * GscAuditPanel — weekly Google Search Console audit surface.
 *
 * Pulls CTR opportunities, ranking changes, cannibalization, and top
 * queries from the search_performance table that gets populated nightly
 * by the gsc-pipeline cron job. Replaces the manual gsc-audit.ts CLI
 * script — now a one-click admin view.
 *
 * Default-collapsed to avoid cluttering the funnel page; click to expand.
 */
function GscAuditPanel({ range }: { range: Range }) {
  const [expanded, setExpanded] = useState(false);
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;

  const { data, isLoading } = trpc.seoTools.weeklyAudit.useQuery(
    { days },
    { enabled: expanded, staleTime: 60 * 60 * 1000 },
  );

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <div className="text-primary text-[10px] font-mono uppercase tracking-widest mb-1">
            Search Console Audit ({range})
          </div>
          <h3 className="font-bold text-base text-foreground tracking-wide uppercase">
            Weekly GSC Audit
          </h3>
          <p className="text-[12px] text-foreground/40 mt-1 max-w-2xl">
            CTR opportunities, ranking drops, cannibalization clusters. Pulled from the
            search_performance table that gsc-pipeline syncs nightly. Replaces the manual
            gsc-audit.ts CLI script.
          </p>
        </div>
        <button
          onClick={() => setExpanded((x) => !x)}
          className="flex items-center gap-2 bg-card border border-border/30 px-4 py-2 text-sm hover:border-primary/30 transition-colors"
        >
          <Search className="w-3.5 h-3.5" />
          {expanded ? "Collapse" : "Run Audit"}
        </button>
      </div>

      {expanded && (
        <div className="bg-card border border-border/30 p-4 space-y-5">
          {isLoading || !data ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
            </div>
          ) : !data.ok ? (
            <div className="text-[12px] text-amber-400">
              GSC audit unavailable. {("authError" in data && data.authError) || "Check pipeline status."}
            </div>
          ) : (
            <>
              {/* CTR opportunities */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                  <h4 className="text-xs font-bold tracking-wider uppercase text-foreground/70">
                    CTR Opportunities ({data.ctrOpportunities.length})
                  </h4>
                </div>
                {data.ctrOpportunities.length === 0 ? (
                  <p className="text-[11px] text-foreground/40 italic">
                    No high-impression / low-CTR queries detected this window.
                  </p>
                ) : (
                  <div className="space-y-1 text-[11px] font-mono">
                    {data.ctrOpportunities.slice(0, 8).map((o: { query: string; impressions: number; currentCtr: number; avgPosition: number }, i: number) => (
                      <div key={i} className="flex items-center gap-3 py-1 border-b border-border/5 last:border-0">
                        <span className="text-foreground/60 truncate flex-1">{o.query}</span>
                        <span className="text-foreground/40 shrink-0">{o.impressions} imp</span>
                        <span className="text-foreground/40 shrink-0">{(o.currentCtr * 100).toFixed(1)}% CTR</span>
                        <span className="text-foreground/40 shrink-0">#{o.avgPosition?.toFixed(1) ?? "—"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Ranking drops */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                  <h4 className="text-xs font-bold tracking-wider uppercase text-foreground/70">
                    Ranking Drops ({data.rankingDrops.length})
                  </h4>
                </div>
                {data.rankingDrops.length === 0 ? (
                  <p className="text-[11px] text-foreground/40 italic">No queries dropped 3+ positions.</p>
                ) : (
                  <div className="space-y-1 text-[11px] font-mono">
                    {data.rankingDrops.slice(0, 8).map((d: { query: string; delta: number; currentPosition: number }, i: number) => (
                      <div key={i} className="flex items-center gap-3 py-1 border-b border-border/5 last:border-0">
                        <span className="text-foreground/60 truncate flex-1">{d.query}</span>
                        <span className="text-red-400 shrink-0">{d.delta} spots</span>
                        <span className="text-foreground/40 shrink-0">now #{d.currentPosition?.toFixed(1) ?? "—"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Cannibalization */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                  <h4 className="text-xs font-bold tracking-wider uppercase text-foreground/70">
                    Cannibalization ({data.cannibalization.length})
                  </h4>
                </div>
                {data.cannibalization.length === 0 ? (
                  <p className="text-[11px] text-foreground/40 italic">No multi-page query competition detected.</p>
                ) : (
                  <div className="space-y-1 text-[11px] font-mono">
                    {data.cannibalization.slice(0, 5).map((c: { query: string; pages: { page: string; position: number }[] }, i: number) => (
                      <div key={i} className="py-1 border-b border-border/5 last:border-0">
                        <div className="text-foreground/70 mb-0.5">{c.query} <span className="text-foreground/30">— {c.pages.length} pages</span></div>
                        <div className="text-foreground/40 pl-3 text-[10px] leading-snug">
                          {c.pages.slice(0, 3).map((p, j: number) => (
                            <div key={j}>{p.page} (pos {p.position?.toFixed(1) ?? "—"})</div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

