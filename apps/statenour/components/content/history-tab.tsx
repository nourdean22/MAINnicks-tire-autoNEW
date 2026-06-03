"use client";

/**
 * HistoryTab · the History section of the merged /content surface (Wave 2).
 *
 * Moved verbatim from the former app/(mastery)/content/history/page.tsx — the
 * only changes are: the outer <StandardPage> wrapper became a fragment (the
 * page-level chrome now lives on /content), the former StandardPage dynamic
 * `description` (scored-reply count) + `loading` prop moved into an inline
 * header/indicator, and the former rhythm="comfortable" spacing is preserved
 * via a `space-y-4` wrapper. The 7-axis critic filters, axis averages +
 * sparkline trends, winners/regen pools, and the sortable results table are
 * unchanged.
 *
 * Search past content scored by the 7-axis critic · pattern-mining surface
 * for shipped content quality.
 */

import { useState, useEffect, useMemo } from "react";
import { Panel } from "@/components/panel";
import { SortDropdown } from "@/components/ui/sort-dropdown";
import { cn } from "@/lib/utils/cn";
import { Search, AlertCircle, TrendingUp } from "lucide-react";
import { Sparkline } from "@/components/ui/sparkline";

// misc-pages slice (2026-05-22) · the scored-content read moved off
// authedFetch onto trpc.operator.contentHistory · a reactive useQuery
// keyed on the filter state (the legacy code rebuilt the fetch in a
// useCallback + useEffect on the same deps).
import { trpc } from "@/lib/trpc/client";
interface QualityRow {
  id: string;
  content: string;
  createdAt: string;
  metadata: {
    overall?: number;
    specificity?: number;
    cliche?: number;
    antiNour?: number;
    length?: number;
    brandElement?: number;
    cta?: number;
    hashtagQuality?: number;
    contentMode?: boolean;
    shouldRegen?: boolean;
    wordCount?: number;
    turnIntent?: string;
    turnShape?: string;
    persona?: string;
    conversationId?: string;
  };
}

interface HistoryResponse {
  ok: boolean;
  window: { days: number; since: string };
  count: number;
  rows: QualityRow[];
  stats: {
    avgOverall: number;
    avgSpecificity: number;
    avgCliche: number;
    avgAntiNour: number;
    avgLength: number;
    avgBrand: number;
    avgCTA: number;
    avgHashtag: number;
    regenRate: number;
    contentModeRate: number;
    byShape: Record<string, number>;
    byIntent: Record<string, number>;
  };
}

function scoreTone(s: number): string {
  if (s >= 80) return "text-emerald-300";
  if (s >= 60) return "text-sky-300";
  if (s >= 40) return "text-amber-300";
  return "text-rose-300";
}

export function HistoryTab() {
  const [q, setQ] = useState("");
  const [minScore, setMinScore] = useState(0);
  const [maxScore, setMaxScore] = useState(100);
  const [days, setDays] = useState(30);
  // v10.0.439 · sort key · 5 modes
  type ContentSort = "newest" | "oldest" | "score-highest" | "score-lowest" | "longest";
  const [sortKey, setSortKey] = useState<ContentSort>(() => {
    if (typeof window === "undefined") return "newest";
    const saved = window.localStorage.getItem("content-history:sortKey");
    const valid: ContentSort[] = ["newest", "oldest", "score-highest", "score-lowest", "longest"];
    return saved && valid.includes(saved as ContentSort) ? (saved as ContentSort) : "newest";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("content-history:sortKey", sortKey);
  }, [sortKey]);
  const [contentOnly, setContentOnly] = useState(false);

  // v10 B.1 FIND-04's res.ok guard is now intrinsic — tRPC surfaces a
  // non-2xx as a thrown error React Query exposes via `error`. The
  // `cache: "no-store"` semantics carry over: the query is keyed on
  // the live filter state so any change refetches.
  const historyQuery = trpc.operator.contentHistory.useQuery({
    q,
    minScore,
    maxScore,
    days,
    contentModeOnly: contentOnly,
  });
  const data = (historyQuery.data ?? null) as HistoryResponse | null;
  const loading = historyQuery.isLoading;
  const error = historyQuery.error
    ? historyQuery.error.message
    : null;

  const winners = useMemo(() => {
    if (!data) return [];
    return data.rows
      .filter((r) => (r.metadata.overall ?? 0) >= 80)
      .slice(0, 10);
  }, [data]);

  const losers = useMemo(() => {
    if (!data) return [];
    return data.rows
      .filter((r) => (r.metadata.overall ?? 0) < 50 && r.metadata.shouldRegen)
      .slice(0, 10);
  }, [data]);

  // v7 · BATCH 2D — Per-axis time series. Bucket rows into 7 day-bins
  // ending today, average each axis per day. Drives the sparkline trend
  // next to each axis tile — Nour sees if cliche-rate is rising,
  // brand-element-score is dropping, etc.
  const axisTrends = useMemo(() => {
    if (!data) return null;
    const buckets: Record<string, { days: Record<string, number[]> }> = {
      overall: { days: {} },
      spec: { days: {} },
      cliche: { days: {} },
      voice: { days: {} },
      length: { days: {} },
      brand: { days: {} },
      CTA: { days: {} },
      tags: { days: {} },
    };
    const dayKeys: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      dayKeys.push(d.toISOString().split("T")[0]);
    }
    for (const k of Object.keys(buckets)) {
      for (const day of dayKeys) buckets[k].days[day] = [];
    }
    for (const r of data.rows) {
      const day = r.createdAt.slice(0, 10);
      if (!dayKeys.includes(day)) continue;
      const m = r.metadata;
      if (typeof m.overall === "number") buckets.overall.days[day].push(m.overall);
      if (typeof m.specificity === "number") buckets.spec.days[day].push(m.specificity);
      if (typeof m.cliche === "number") buckets.cliche.days[day].push(m.cliche);
      if (typeof m.antiNour === "number") buckets.voice.days[day].push(m.antiNour);
      if (typeof m.length === "number") buckets.length.days[day].push(m.length);
      if (typeof m.brandElement === "number") buckets.brand.days[day].push(m.brandElement);
      if (typeof m.cta === "number") buckets.CTA.days[day].push(m.cta);
      if (typeof m.hashtagQuality === "number") buckets.tags.days[day].push(m.hashtagQuality);
    }
    const series: Record<string, number[]> = {};
    for (const k of Object.keys(buckets)) {
      series[k] = dayKeys.map((day) => {
        const vals = buckets[k].days[day];
        if (vals.length === 0) return 0;
        return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
      });
    }
    return series;
  }, [data]);

  return (
    <>
      <p className="text-sm text-[var(--text-secondary)] mb-4">
        {data ? `${data.count} scored replies · last ${days}d` : "loading…"}
      </p>

      {loading && !data && (
        <div className="text-sm text-zinc-500 mb-4">loading content history…</div>
      )}

      <div className="space-y-4">
        {/* Filter row */}
        <Panel>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500">search</label>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-zinc-500" />
                <input
                  type="text"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="brake / oil / tire..."
                  className="w-full rounded-md border border-white/10 bg-white/[0.02] pl-7 pr-2 py-1 text-xs text-zinc-200 placeholder:text-zinc-500 outline-none focus:border-white/25"
                />
              </div>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500">
                score: {minScore}-{maxScore}
              </label>
              <div className="flex gap-1 items-center">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={minScore}
                  onChange={(e) => setMinScore(Math.min(maxScore, Number(e.target.value)))}
                  className="flex-1"
                />
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={maxScore}
                  onChange={(e) => setMaxScore(Math.max(minScore, Number(e.target.value)))}
                  className="flex-1"
                />
              </div>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500">days</label>
              <div className="flex gap-1 mt-0.5">
                {[1, 7, 30, 90].map((d) => (
                  <button
                    key={d}
                    onClick={() => setDays(d)}
                    className={cn(
                      "rounded-md px-2 py-1 text-[10px] font-mono",
                      days === d
                        ? "bg-white/10 text-white"
                        : "bg-white/[0.02] text-zinc-500 hover:bg-white/[0.06]",
                    )}
                  >
                    {d}d
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-zinc-500">filters</label>
              <div className="flex gap-1 mt-0.5">
                <button
                  onClick={() => setContentOnly((x) => !x)}
                  className={cn(
                    "rounded-md px-2 py-1 text-[10px] font-mono",
                    contentOnly
                      ? "bg-violet-500/15 text-violet-200"
                      : "bg-white/[0.02] text-zinc-500 hover:bg-white/[0.06]",
                  )}
                >
                  content only
                </button>
              </div>
            </div>
          </div>
        </Panel>

        {error && (
          <Panel className="border-rose-500/40 bg-rose-500/10">
            <div className="flex items-center gap-2 p-3 text-sm text-rose-200">
              <AlertCircle className="h-4 w-4" />
              <span>{error}</span>
            </div>
          </Panel>
        )}

        {/* Aggregate stats — axis-by-axis */}
        {data && data.count > 0 && (
          <Panel>
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
              <TrendingUp className="h-4 w-4" /> axis averages
            </div>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
              <Axis label="overall" value={data.stats.avgOverall} trend={axisTrends?.overall} />
              <Axis label="spec" value={data.stats.avgSpecificity} trend={axisTrends?.spec} />
              <Axis label="cliche" value={data.stats.avgCliche} trend={axisTrends?.cliche} />
              <Axis label="voice" value={data.stats.avgAntiNour} trend={axisTrends?.voice} />
              <Axis label="length" value={data.stats.avgLength} trend={axisTrends?.length} />
              <Axis label="brand" value={data.stats.avgBrand} trend={axisTrends?.brand} />
              <Axis label="CTA" value={data.stats.avgCTA} trend={axisTrends?.CTA} />
              <Axis label="tags" value={data.stats.avgHashtag} trend={axisTrends?.tags} />
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-[10px]">
              <span className="text-zinc-400">
                regen rate: <span className={data.stats.regenRate > 0.2 ? "text-rose-300" : "text-emerald-300"}>
                  {(data.stats.regenRate * 100).toFixed(0)}%
                </span>
              </span>
              <span className="text-zinc-400">
                content mode: <span className="text-violet-300">{(data.stats.contentModeRate * 100).toFixed(0)}%</span>
              </span>
            </div>
          </Panel>
        )}

        {/* Winners + Losers sidebars */}
        {data && (winners.length > 0 || losers.length > 0) && (
          <div className="grid gap-3 md:grid-cols-2">
            {winners.length > 0 && (
              <Panel>
                <h2 className="mb-2 text-sm font-semibold text-emerald-300">winners (≥80)</h2>
                <div className="space-y-1">
                  {winners.map((r) => (
                    <div
                      key={r.id}
                      className="rounded px-2 py-1.5 hover:bg-white/[0.03] text-[10px] font-mono text-zinc-300"
                    >
                      <span className={cn("font-bold mr-2", scoreTone(r.metadata.overall ?? 0))}>
                        {r.metadata.overall ?? "—"}
                      </span>
                      <span className="opacity-70">{r.metadata.turnIntent ?? "—"}/{r.metadata.turnShape ?? "—"}</span>
                      <span className="ml-2 opacity-60">
                        {new Date(r.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </div>
              </Panel>
            )}
            {losers.length > 0 && (
              <Panel>
                <h2 className="mb-2 text-sm font-semibold text-rose-300">regen pool (&lt;50)</h2>
                <div className="space-y-1">
                  {losers.map((r) => (
                    <div
                      key={r.id}
                      className="rounded px-2 py-1.5 hover:bg-white/[0.03] text-[10px] font-mono text-zinc-300"
                    >
                      <span className={cn("font-bold mr-2", scoreTone(r.metadata.overall ?? 0))}>
                        {r.metadata.overall ?? "—"}
                      </span>
                      <span className="opacity-70">{r.metadata.turnIntent ?? "—"}/{r.metadata.turnShape ?? "—"}</span>
                      <span className="ml-2 opacity-60">
                        {new Date(r.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </div>
              </Panel>
            )}
          </div>
        )}

        {/* Full row list */}
        {data && data.rows.length > 0 && (
          <Panel>
            <div className="mb-2 flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-sm font-semibold text-white">
                results ({data.count} total · showing {data.rows.length})
              </h2>
              {/* v10.0.439 · sort dropdown · 5 modes */}
              <SortDropdown<ContentSort>
                value={sortKey}
                onChange={setSortKey}
                defaultValue="newest"
                ariaLabel="Sort content history"
                options={[
                  { value: "newest", label: "newest first" },
                  { value: "oldest", label: "oldest first" },
                  { value: "score-highest", label: "score · highest" },
                  { value: "score-lowest", label: "score · lowest" },
                  { value: "longest", label: "longest content" },
                ]}
              />
            </div>
            {/* v10.0.529.106 · Wave 51 · mobile fix · the 7-col table was
                already wrapped in overflow-x-auto but each col uses px-2
                and the snippet col is max-w-md (~448px) which makes the
                full table comically wide on iPhone. Hide spec+brand+cta+
                intent+snippet on mobile · they're the columns the operator
                least needs at a glance (overall score + date are the keys
                to "is this content history pane healthy"). Show the rest
                from sm: breakpoint up where there's actual room. */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-zinc-500">
                  <tr>
                    <th className="px-2 py-2 text-left font-medium">when</th>
                    <th className="px-2 py-2 text-right font-medium">overall</th>
                    <th className="hidden sm:table-cell px-2 py-2 text-right font-medium">spec</th>
                    <th className="hidden sm:table-cell px-2 py-2 text-right font-medium">brand</th>
                    <th className="hidden sm:table-cell px-2 py-2 text-right font-medium">cta</th>
                    <th className="hidden md:table-cell px-2 py-2 text-left font-medium">intent / shape</th>
                    <th className="hidden md:table-cell px-2 py-2 text-left font-medium">snippet</th>
                  </tr>
                </thead>
                <tbody>
                  {[...data.rows].sort((a, b) => {
                    switch (sortKey) {
                      case "oldest":
                        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
                      case "score-highest":
                        return (b.metadata?.overall ?? 0) - (a.metadata?.overall ?? 0);
                      case "score-lowest":
                        return (a.metadata?.overall ?? 0) - (b.metadata?.overall ?? 0);
                      case "longest":
                        return (b.content?.length ?? 0) - (a.content?.length ?? 0);
                      case "newest":
                      default:
                        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
                    }
                  }).map((r) => (
                    <tr key={r.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                      <td className="px-2 py-1.5 tabular-nums text-zinc-500">
                        {new Date(r.createdAt).toLocaleDateString()}
                      </td>
                      <td className={cn("px-2 py-1.5 text-right font-mono font-bold tabular-nums", scoreTone(r.metadata.overall ?? 0))}>
                        {r.metadata.overall ?? "—"}
                      </td>
                      <td className="hidden sm:table-cell px-2 py-1.5 text-right font-mono tabular-nums text-zinc-400">
                        {r.metadata.specificity ?? "—"}
                      </td>
                      <td className="hidden sm:table-cell px-2 py-1.5 text-right font-mono tabular-nums text-zinc-400">
                        {r.metadata.brandElement ?? "—"}
                      </td>
                      <td className="hidden sm:table-cell px-2 py-1.5 text-right font-mono tabular-nums text-zinc-400">
                        {r.metadata.cta ?? "—"}
                      </td>
                      <td className="hidden md:table-cell px-2 py-1.5 font-mono text-[10px] text-zinc-400">
                        {r.metadata.turnIntent ?? "—"}/{r.metadata.turnShape ?? "—"}
                      </td>
                      <td className="hidden md:table-cell px-2 py-1.5 truncate max-w-md text-zinc-300">
                        {r.content.slice(0, 80)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        )}

        {!loading && data && data.rows.length === 0 && (
          <Panel>
            <p className="p-4 text-center text-sm text-zinc-500">
              No content scored in this window with these filters.
            </p>
          </Panel>
        )}

        <p className="pt-2 text-center text-[10px] text-zinc-600">
          source: brain_memory category=nick_quality · written post-stream by output-critic
        </p>
      </div>
    </>
  );
}

function Axis({ label, value, trend }: { label: string; value: number; trend?: number[] }) {
  // Trend tone based on direction. cliche/voice/length INVERT — higher = better
  // (less cliche = high cliche-AXIS score). overall/brand/CTA/tags up = better.
  // Color the sparkline based on direction + axis polarity.
  const last = trend ? trend[trend.length - 1] : 0;
  const first = trend ? trend[0] : 0;
  const goingUp = last > first;
  const upIsGood = !["cliche", "voice"].includes(label); // most axes — up is good
  const trendColor = !trend || trend.length < 2
    ? "#7dd3fc"
    : (goingUp === upIsGood ? "#34d399" : last === first ? "#7dd3fc" : "#f87171");
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-2 text-center">
      <div className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={cn("mt-0.5 font-mono text-lg font-bold tabular-nums", scoreTone(value))}>
        {value}
      </div>
      {trend && trend.some((v) => v > 0) && (
        <div className="mt-0.5">
          <Sparkline
            data={trend}
            width={56}
            height={14}
            color={trendColor}
            showDot
            animate={false}
          />
        </div>
      )}
    </div>
  );
}
