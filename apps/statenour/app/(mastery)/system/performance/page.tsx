"use client";

/**
 * /system/performance — per-route latency + error-rate dashboard.
 *
 * Reads from api_request_logs (written by apiHandler on every call)
 * and surfaces p50/p95/p99 per path. Until now, knowing "which route
 * is slow" required running ad-hoc queries in Prisma Studio. This
 * page makes it one click.
 *
 * Alive+dynamic:
 *   - Window selector (1h / 6h / 24h / 7d / 30d) — re-fetches on change
 *   - Min-requests guard (default 5) — filters out one-off spikes
 *   - Slow routes (p95 > 2s) badged + sorted to the top
 *   - Error-rate chip — red when >5% errors, amber 1-5%, muted <1%
 *
 * Power move: this is the ONE place you can see every API endpoint's
 * latency budget at a glance. Degradations show up here before users
 * feel them.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { StandardPage } from "@/components/layout/standard-page";
import { Panel } from "@/components/panel";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { authedFetch } from "@/hooks/use-authed-fetch";
import { cn } from "@/lib/utils/cn";
import { AlertCircle, Flame, Timer, TrendingUp } from "lucide-react";

interface PerfRow {
  path: string;
  method: string;
  requests: number;
  errors: number;
  errorRate: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  avgMs: number;
  maxMs: number;
  slow: boolean;
}

interface Payload {
  window: { hours: number; since: string };
  slowThresholdMs: number;
  summary: {
    totalRoutes: number;
    slowRoutes: number;
    errorRoutes: number;
    totalRequests: number;
    totalErrors: number;
  };
  routes: PerfRow[];
  generatedAt: string;
}

function latencyClass(ms: number): string {
  if (ms > 2000) return "text-rose-300";
  if (ms > 1000) return "text-amber-300";
  if (ms > 500) return "text-sky-300";
  return "text-emerald-300";
}

function errorRateClass(rate: number): string {
  if (rate > 0.05) return "text-rose-300";
  if (rate > 0.01) return "text-amber-300";
  return "text-[var(--text-muted)]";
}

export default function PerformancePage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hours, setHours] = useState(24);
  const [search, setSearch] = useState("");
  const [showSlowOnly, setShowSlowOnly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch(
        `/api/system/performance?hours=${hours}`,
        { cache: "no-store" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json.data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [hours]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const routes = Array.isArray(data.routes) ? data.routes : [];
    return routes.filter((r) => {
      if (showSlowOnly && !r.slow) return false;
      if (search && !r.path.toLowerCase().includes(search.toLowerCase()))
        return false;
      return true;
    });
  }, [data, showSlowOnly, search]);

  return (
    <StandardPage
      eyebrow="NOUR OS · System"
      title="performance"
      description={
        data
          ? `${data.summary.totalRoutes} routes · ${data.summary.totalRequests.toLocaleString()} requests · ${data.summary.slowRoutes} slow (p95 > ${(data.slowThresholdMs / 1000).toFixed(1)}s) · ${data.summary.totalErrors} errors`
          : ""
      }
      width="2xl"
      rhythm="comfortable"
      actions={
        <FreshnessChip
          lastFetchedAt={data?.generatedAt ?? null}
          source={`api_request_logs · last ${hours}h`}
          onReload={load}
        />
      }
    >
      {error && (
        <Panel className="border-rose-500/40 bg-rose-500/10">
          <div className="flex items-center gap-2 p-3 text-sm text-rose-200">
            <AlertCircle className="h-4 w-4" />
            <span>{error}</span>
          </div>
        </Panel>
      )}

      {/* Window + filter controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.02] p-1 text-xs">
          {[1, 6, 24, 24 * 7, 24 * 30].map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => setHours(h)}
              className={cn(
                "rounded-md px-2 py-1 transition-colors",
                hours === h
                  ? "bg-white/10 text-[var(--text-primary)]"
                  : "text-[var(--text-secondary)] hover:bg-white/5",
              )}
            >
              {h < 24 ? `${h}h` : h === 24 ? "24h" : h === 24 * 7 ? "7d" : "30d"}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setShowSlowOnly((x) => !x)}
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors",
            showSlowOnly
              ? "border-rose-500/35 bg-rose-500/10 text-rose-300"
              : "border-white/10 bg-white/[0.02] text-[var(--text-secondary)] hover:bg-white/5",
          )}
        >
          <Flame className="h-3 w-3" />
          slow only
        </button>
        <input
          type="text"
          placeholder="filter path..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[160px] rounded-lg border border-white/10 bg-white/[0.02] px-3 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-white/20"
        />
      </div>

      {/* Rollup tiles */}
      {data && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile
            label="Total requests"
            value={data.summary.totalRequests.toLocaleString()}
            tone="neutral"
          />
          <Tile
            label="Slow routes"
            value={String(data.summary.slowRoutes)}
            tone={data.summary.slowRoutes > 0 ? "warn" : "ok"}
            hint={`p95 > ${(data.slowThresholdMs / 1000).toFixed(1)}s`}
          />
          <Tile
            label="Error routes"
            value={String(data.summary.errorRoutes)}
            tone={data.summary.errorRoutes > 0 ? "critical" : "ok"}
            hint=">5% error rate"
          />
          <Tile
            label="Total errors"
            value={data.summary.totalErrors.toLocaleString()}
            tone={data.summary.totalErrors > 10 ? "warn" : "ok"}
          />
        </div>
      )}

      {/* Per-route table */}
      {loading && !data ? (
        <Panel>
          <div className="p-6 text-center text-sm text-[var(--text-muted)]">
            Loading performance data…
          </div>
        </Panel>
      ) : filtered.length === 0 ? (
        <Panel>
          <div className="p-6 text-center text-sm text-[var(--text-muted)]">
            {showSlowOnly
              ? "No slow routes in this window — performance looks healthy."
              : "No routes match this filter."}
          </div>
        </Panel>
      ) : (
        <Panel>
          {/* v8.24 · mobile-responsive: outer scroll guard + p50/p99/max
              hidden on phone-narrow viewports (the operator first-glance
              triage needs path / req / p95 / err — the others are
              drill-down detail visible on tablet+). Path column truncates
              with monospace ellipsis instead of wrapping into a 4-line
              cell that buries the row. */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[480px]">
              <thead className="text-[var(--text-muted)]">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">path</th>
                  <th className="px-2 py-2 text-right font-medium" title="Requests">
                    req
                  </th>
                  <th className="hidden md:table-cell px-2 py-2 text-right font-medium" title="50th percentile latency">
                    p50
                  </th>
                  <th className="px-2 py-2 text-right font-medium" title="95th percentile">
                    p95
                  </th>
                  <th className="hidden lg:table-cell px-2 py-2 text-right font-medium" title="99th percentile">
                    p99
                  </th>
                  <th className="hidden md:table-cell px-2 py-2 text-right font-medium" title="Max observed">
                    max
                  </th>
                  <th className="px-3 py-2 text-right font-medium" title="Error rate">
                    err
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={`${r.method}:${r.path}`}
                    className={cn(
                      "border-t border-white/5 text-[var(--text-secondary)] hover:bg-white/[0.02]",
                      r.slow && "bg-rose-500/[0.03]",
                    )}
                  >
                    <td className="px-3 py-1.5 font-mono max-w-[180px] sm:max-w-none truncate">
                      <span className="mr-1.5 rounded border border-white/10 bg-white/5 px-1 py-0.5 text-[9px] uppercase tracking-wide">
                        {r.method}
                      </span>
                      <span>{r.path}</span>
                      {r.slow && (
                        <span className="ml-2 inline-flex items-center gap-0.5 rounded-full border border-rose-500/35 bg-rose-500/10 px-1.5 py-0.5 text-[10px] text-rose-300">
                          <Flame className="h-2.5 w-2.5" /> slow
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {r.requests.toLocaleString()}
                    </td>
                    <td className={cn("hidden md:table-cell px-2 py-1.5 text-right tabular-nums", latencyClass(r.p50Ms))}>
                      {r.p50Ms}
                    </td>
                    <td className={cn("px-2 py-1.5 text-right tabular-nums", latencyClass(r.p95Ms))}>
                      {r.p95Ms}
                    </td>
                    <td className={cn("hidden lg:table-cell px-2 py-1.5 text-right tabular-nums", latencyClass(r.p99Ms))}>
                      {r.p99Ms}
                    </td>
                    <td className={cn("hidden md:table-cell px-2 py-1.5 text-right tabular-nums", latencyClass(r.maxMs))}>
                      {r.maxMs}
                    </td>
                    <td className={cn("px-3 py-1.5 text-right tabular-nums whitespace-nowrap", errorRateClass(r.errorRate))}>
                      {(r.errorRate * 100).toFixed(1)}%
                      <span className="ml-1 hidden sm:inline text-[9px] opacity-60">
                        ({r.errors}/{r.requests})
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel>
        <div className="flex items-start gap-3 p-3 text-xs text-[var(--text-secondary)]">
          <Timer className="h-4 w-4 shrink-0 text-[var(--text-muted)]" />
          <div>
            <div className="font-semibold text-[var(--text-primary)]">
              How this data is collected
            </div>
            <div className="mt-1">
              Every route wrapped with{" "}
              <code className="font-mono">apiHandler</code> in{" "}
              <code className="font-mono">lib/utils/http.ts</code> persists a
              row to <code className="font-mono">api_request_logs</code> on
              completion. This page computes percentiles via Postgres{" "}
              <code className="font-mono">percentile_cont</code> — no
              in-process sort on 10K+ rows. Slow threshold:{" "}
              <span className="text-rose-300">p95 &gt; 2s</span>.
            </div>
            <div className="mt-1">
              <Link
                href="/system/health"
                className="text-sky-300 hover:underline"
              >
                ← back to diagnostics
              </Link>
            </div>
          </div>
        </div>
      </Panel>
    </StandardPage>
  );
}

function Tile({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone: "ok" | "warn" | "critical" | "neutral";
  hint?: string;
}) {
  const border =
    tone === "critical"
      ? "border-rose-500/40"
      : tone === "warn"
        ? "border-amber-500/30"
        : tone === "ok"
          ? "border-emerald-500/30"
          : "border-white/10";
  const bg =
    tone === "critical"
      ? "bg-rose-500/[0.08]"
      : tone === "warn"
        ? "bg-amber-500/[0.06]"
        : tone === "ok"
          ? "bg-emerald-500/[0.05]"
          : "bg-white/[0.02]";
  return (
    <div className={cn("rounded-lg border p-3", border, bg)}>
      <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-[var(--text-primary)]">
        {value}
      </div>
      {hint && (
        <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">{hint}</div>
      )}
    </div>
  );
}
