"use client";

/**
 * /seo · Intelligence Dispersal Wave 3 follow-through · #79 (2026-05-24)
 *
 * The statenour home for nickstire shop's search-performance signal:
 *   GSC summary · Top queries · Top pages.
 *
 * Pulls via the bridge contract v11.7:
 *   · gsc_summary · 30-day clicks / impressions / CTR / position
 *   · gsc_top_queries · top 10 query strings by clicks
 *   · gsc_top_pages · top 10 landing pages by clicks (new in v11.7)
 *
 * All three actions live in nickstire (see apps/nickstire/server/
 * routes/nour-os-query.ts) and are wrapped by the browser-safe proxy
 * at /api/nickstire/query. Bridge contract:
 * apps/nickstire/docs/NICKSTIRE-QUERY-CONTRACT.md §v11.7.
 *
 * Aesthetic: editorial-minimalist · matches /funnel + /scoreboard's
 * NickHealthSection. Card visual contract:
 * `border-white/10 bg-white/[0.02]` + `text-[10px] uppercase
 * tracking-[0.18em] text-white/40` eyebrow.
 *
 * Graceful degradation: self-hides on bridge failure · no error toast ·
 * matches the pattern from /funnel and /scoreboard.
 *
 * Mobile: single column · KPIs stack 2×2 · tables truncate gracefully.
 *
 * Per docs/2026-05-24-intelligence-dispersal-plan.md §5 Wave 3 · this
 * is the second of the two remaining statenour gap surfaces (the
 * other is /radar). nickstire never had a dedicated SEO surface · the
 * GSC pipeline was only used by the AI COO. This page makes it a
 * first-class operator surface.
 */

import { useEffect, useState } from "react";
import { MasterySectionLabel } from "@/components/mastery/mastery-section-label";

interface GscSummary {
  ok: true;
  from: string;
  to: string;
  totalClicks: number;
  totalImpressions: number;
  avgCtr: number;
  avgPosition: number;
}

interface GscQuery {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  avgPosition: number;
}

interface GscQueriesData {
  ok: true;
  from: string;
  to: string;
  queries: GscQuery[];
  count: number;
}

interface GscPage {
  page: string;
  clicks: number;
  impressions: number;
  avgCtr: number;
}

interface GscPagesData {
  ok: true;
  from: string;
  pages: GscPage[];
  count: number;
}

export default function SeoPage() {
  const [summary, setSummary] = useState<GscSummary | null>(null);
  const [queries, setQueries] = useState<GscQueriesData | null>(null);
  const [pages, setPages] = useState<GscPagesData | null>(null);
  const [bridgeOk, setBridgeOk] = useState<"loading" | "ok" | "down">("loading");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [sRes, qRes, pRes] = await Promise.all([
          fetch("/api/nickstire/query?q=gsc_summary"),
          fetch("/api/nickstire/query?q=gsc_top_queries&limit=10"),
          fetch("/api/nickstire/query?q=gsc_top_pages&limit=10"),
        ]);
        const [sJson, qJson, pJson] = await Promise.all([
          sRes.json(),
          qRes.json(),
          pRes.json(),
        ]);
        if (cancelled) return;

        // Bridge returns { data, query, timestamp } on success; inner
        // `data` is the handler return. gsc_* handlers don't include
        // ok:true · wrap inferred presence as the "ok" check.
        const sData = sJson?.data;
        const qData = qJson?.data;
        const pData = pJson?.data;

        if (!sData || typeof sData.totalClicks !== "number") {
          setBridgeOk("down");
          return;
        }
        setSummary({ ok: true, ...sData } as GscSummary);
        if (qData?.queries) setQueries({ ok: true, ...qData } as GscQueriesData);
        if (pData?.pages) setPages({ ok: true, ...pData } as GscPagesData);
        setBridgeOk("ok");
      } catch {
        if (!cancelled) setBridgeOk("down");
      }
    };
    void load();
    // Refresh every 15 minutes · GSC pipeline updates nightly · faster
    // poll would just thrash the cache without surfacing new data.
    const id = setInterval(load, 900_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (bridgeOk === "down") {
    return (
      <main className="min-h-[100dvh] bg-[#0A0A0A] text-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
          <h1 className="text-2xl font-medium tracking-tight">SEO</h1>
          <p className="mt-4 text-sm text-white/40">
            Bridge to nickstire unavailable · the GSC pipeline lives there.
            Check the bridge status on /system/brain-bus.
          </p>
        </div>
      </main>
    );
  }

  if (bridgeOk === "loading" || !summary) {
    return (
      <main className="min-h-[100dvh] bg-[#0A0A0A] text-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
          <h1 className="text-2xl font-medium tracking-tight">SEO</h1>
          <p className="mt-4 text-sm text-white/30 animate-pulse">Loading…</p>
        </div>
      </main>
    );
  }

  // Pre-formatted summary values · CTR + position both percentage-like
  const ctr = summary.avgCtr.toFixed(2);
  const pos = summary.avgPosition.toFixed(1);

  return (
    <main className="min-h-[100dvh] bg-[#0A0A0A] text-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <header>
          <h1 className="text-2xl font-medium tracking-tight">SEO</h1>
          <p className="mt-2 text-sm text-white/50">
            Search performance · {summary.from} → {summary.to} ·{" "}
            <span className="text-emerald-300 font-mono">{summary.totalClicks.toLocaleString()}</span>{" "}
            clicks ·{" "}
            <span className="font-mono text-white/70">{summary.totalImpressions.toLocaleString()}</span>{" "}
            impressions.
          </p>
        </header>

        {/* KPI grid · 2×2 on mobile, 4-up on desktop */}
        <section className="mt-8">
          <MasterySectionLabel label="Performance" count={4} />
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Kpi label="Clicks" value={summary.totalClicks.toLocaleString()} color="emerald" />
            <Kpi label="Impressions" value={summary.totalImpressions.toLocaleString()} color="white" />
            <Kpi label="CTR" value={`${ctr}%`} color={summary.avgCtr >= 3 ? "emerald" : summary.avgCtr >= 1.5 ? "amber" : "red"} />
            <Kpi label="Avg Position" value={pos} color={summary.avgPosition <= 5 ? "emerald" : summary.avgPosition <= 15 ? "amber" : "red"} />
          </div>
        </section>

        {/* Top queries */}
        {queries && queries.queries.length > 0 && (
          <section className="mt-10 space-y-3">
            <MasterySectionLabel label="Top queries · by clicks" count={queries.queries.length} />
            <div className="rounded-lg border border-white/10 bg-white/[0.02] divide-y divide-white/[0.04]">
              {queries.queries.map((q) => (
                <div key={q.query} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-white/85 truncate">{q.query}</p>
                    <p className="text-[10px] text-white/40 tabular-nums">
                      {q.impressions.toLocaleString()} impressions · pos {q.avgPosition.toFixed(1)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[14px] font-mono font-medium tabular-nums text-emerald-300">
                      {q.clicks.toLocaleString()}
                    </p>
                    <p className="text-[10px] text-white/40 tabular-nums">
                      {q.ctr.toFixed(2)}% CTR
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Top pages */}
        {pages && pages.pages.length > 0 && (
          <section className="mt-10 space-y-3">
            <MasterySectionLabel label="Top pages · by clicks" count={pages.pages.length} />
            <div className="rounded-lg border border-white/10 bg-white/[0.02] divide-y divide-white/[0.04]">
              {pages.pages.map((p) => (
                <div key={p.page} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-white/85 truncate font-mono">
                      {p.page.replace(/^https?:\/\/[^/]+/, "") || "/"}
                    </p>
                    <p className="text-[10px] text-white/40 tabular-nums">
                      {p.impressions.toLocaleString()} impressions
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[14px] font-mono font-medium tabular-nums text-emerald-300">
                      {p.clicks.toLocaleString()}
                    </p>
                    <p className="text-[10px] text-white/40 tabular-nums">
                      {p.avgCtr.toFixed(2)}% CTR
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        <p className="mt-12 text-[10px] uppercase tracking-[0.22em] text-white/30">
          via nickstire bridge · v11.7 · GSC nightly pipeline · refreshes every 15 min
        </p>
      </div>
    </main>
  );
}

/**
 * Inline KPI tile · matches the /scoreboard NickHealthSection visual.
 * 4 supported tones · emerald / amber / red / white. Single-purpose,
 * 30 LOC, no need to extract until a 3rd consumer.
 */
function Kpi({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: "emerald" | "amber" | "red" | "white";
}) {
  const colorClass =
    color === "emerald"
      ? "text-emerald-300"
      : color === "amber"
      ? "text-amber-300"
      : color === "red"
      ? "text-red-300"
      : "text-white";
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.02] px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.18em] text-white/40">{label}</p>
      <p className={`mt-1 text-[20px] font-medium tabular-nums ${colorClass}`}>{value}</p>
    </div>
  );
}
