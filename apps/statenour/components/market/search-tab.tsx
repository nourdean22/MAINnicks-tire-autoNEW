"use client";

/**
 * SearchTab · the Search section of the merged /market surface (Wave 2).
 *
 * Moved verbatim from the former app/(mastery)/seo/page.tsx — the only
 * change is the outer <StandardPage> wrapper became a fragment (the page-
 * level chrome now lives on /market), and the former StandardPage
 * `description` (clicks/impressions summary line) moved to an inline
 * subtitle at the top of the fragment so nothing is lost. Data fetching,
 * loading/down states, the 4-KPI grid, top-queries + top-pages tables,
 * and the footer are unchanged.
 *
 * Pulls via the bridge contract v11.7:
 *   · gsc_summary · 30-day clicks / impressions / CTR / position
 *   · gsc_top_queries · top 10 query strings by clicks
 *   · gsc_top_pages · top 10 landing pages by clicks
 *
 * All three actions live in nickstire (see apps/nickstire/server/
 * routes/nour-os-query.ts) and are wrapped by the browser-safe proxy
 * at /api/nickstire/query. Bridge contract:
 * apps/nickstire/docs/NICKSTIRE-QUERY-CONTRACT.md §v11.7.
 *
 * Note: "top pages" here = GSC clicks (search demand). The /market
 * Radar tab's "top pages" = CRM conversion — a different signal; the
 * tabs keep their own labels so the two never read as the same thing.
 */

import { MasterySectionLabel } from "@/components/mastery/mastery-section-label";
import { BridgeShell } from "@/components/mastery/bridge-shell";
import { usePollingFetch } from "@/hooks/use-polling-fetch";

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

type SummaryRaw = Omit<GscSummary, "ok">;
type QueriesRaw = Omit<GscQueriesData, "ok">;
type PagesRaw = Omit<GscPagesData, "ok">;

export function SearchTab() {
  // 2026-05-24 · Wave X.g · migrated off the inline 40-LOC fetch loop
  // onto three `usePollingFetch` calls. Each runs independently · the
  // page already isolated per-sub-report degrade so the hook's
  // independence matches the existing semantics. 15-min interval
  // matches the GSC pipeline's nightly update cadence (faster poll
  // would thrash the cache without surfacing new data). gsc_*
  // handlers don't include `ok:true` in their payload · the page
  // synthesizes it for type compatibility with the interfaces.
  const {
    data: summaryRaw,
    loading: summaryLoading,
    error: summaryError,
  } = usePollingFetch<SummaryRaw>(
    "/api/nickstire/query?q=gsc_summary",
    { intervalMs: 900_000 },
  );
  const { data: queriesRaw } = usePollingFetch<QueriesRaw>(
    "/api/nickstire/query?q=gsc_top_queries&limit=10",
    { intervalMs: 900_000 },
  );
  const { data: pagesRaw } = usePollingFetch<PagesRaw>(
    "/api/nickstire/query?q=gsc_top_pages&limit=10",
    { intervalMs: 900_000 },
  );

  const summary: GscSummary | null =
    summaryRaw && typeof summaryRaw.totalClicks === "number"
      ? ({ ok: true, ...summaryRaw } as GscSummary)
      : null;
  const queries: GscQueriesData | null = queriesRaw?.queries
    ? ({ ok: true, ...queriesRaw } as GscQueriesData)
    : null;
  const pages: GscPagesData | null = pagesRaw?.pages
    ? ({ ok: true, ...pagesRaw } as GscPagesData)
    : null;
  const bridgeOk: "loading" | "ok" | "down" =
    summaryError ? "down" : summaryLoading && !summary ? "loading" : summary ? "ok" : "down";

  if (bridgeOk === "down") return <BridgeShell title="SEO" state="down" />;
  if (bridgeOk === "loading" || !summary) return <BridgeShell title="SEO" state="loading" />;

  // Pre-formatted summary values · CTR + position both percentage-like
  const ctr = summary.avgCtr.toFixed(2);
  const pos = summary.avgPosition.toFixed(1);

  return (
    <>
      <p className="text-sm text-white/60 mb-4">
        Search performance · {summary.from} → {summary.to} ·{" "}
        <span className="text-emerald-300 font-mono">{summary.totalClicks.toLocaleString()}</span>{" "}
        clicks ·{" "}
        <span className="font-mono text-white/70">{summary.totalImpressions.toLocaleString()}</span>{" "}
        impressions.
      </p>

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
          via nickstire bridge · GSC nightly pipeline · refreshes every 15 min
        </p>
    </>
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
