"use client";

/**
 * /system/agent-traces · v10 Track E.5 · Apr 30.
 *
 * Operator UI for the v10.0.8 AgentTrace contract. Reads from
 * /api/system/agent-traces and shows:
 *   · 5-axis pulse summary (chains, calls, error chains, cost, latency)
 *   · Source filter (chat / cron / autonomous / tool / journal / brain / other)
 *   · Recent trace chains, each one collapsed by default with a
 *     summary line (root label · provider · cost · duration · error?).
 *     Click to expand the child call ladder.
 *
 * Closes the AI-call observability gap. Combined with /system/ai-cost
 * (revenue lens) and /system/errors (failure lens), the operator can
 * answer:  "What did Nick do this turn — and why?"
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { StandardPage } from "@/components/layout/standard-page";
import { Panel } from "@/components/panel";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { SortDropdown } from "@/components/ui/sort-dropdown";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { TrendCounter } from "@/components/ui/trend-counter";
// Phase B.7a (2026-05-22) · REST→tRPC system-pages slice · the
// authedFetch read is now `trpc.system.agentTraces.useQuery`. React
// Query keys on the `{ source }` input so switching the source filter
// refetches without a manual `load()`.
import { trpc } from "@/lib/trpc/client";
import {
  AlertTriangle,
  Activity,
  CheckCircle2,
  Clock,
  Coins,
  Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ChainChild {
  id: string;
  label: string;
  source: string;
  provider: string | null;
  durationMs: number | null;
  costCents: number | null;
  errorClass: string | null;
  startedAt: string;
}

interface Chain {
  traceId: string;
  rootLabel: string;
  rootSource: string;
  callCount: number;
  totalDurationMs: number;
  totalCostCents: number;
  hasError: boolean;
  startedAt: string;
  children: ChainChild[];
}

interface AgentTracePayload {
  generatedAt: string;
  filter: { limit: number; source: string | null };
  stats: {
    chainCount: number;
    totalCalls: number;
    totalCostCents: number;
    totalDurationMs: number;
    errorChains: number;
    errorRate: number;
  };
  /** v10.0.223 · prior-24h baseline for TrendCounter deltas. Optional
   *  — older payloads pre-deploy may not include it. */
  previous?: {
    chainCount: number;
    totalCalls: number;
    totalCostCents: number;
    totalDurationMs: number;
    errorChains: number;
  };
  chains: Chain[];
}

type SourceFilter =
  | "all"
  | "chat"
  | "cron"
  | "autonomous"
  | "tool"
  | "journal"
  | "brain"
  | "other";

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

function fmtMs(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmtCents(cents: number | null): string {
  if (cents == null || cents === 0) return "$0";
  if (cents < 100) return `${cents}¢`;
  return `$${(cents / 100).toFixed(2)}`;
}

function sourceColor(source: string): string {
  switch (source) {
    case "chat":
      return "text-emerald-200 bg-emerald-500/10";
    case "cron":
      return "text-sky-200 bg-sky-500/10";
    case "autonomous":
      return "text-violet-200 bg-violet-500/10";
    case "tool":
      return "text-amber-200 bg-amber-500/10";
    case "journal":
      return "text-pink-200 bg-pink-500/10";
    case "brain":
      return "text-indigo-200 bg-indigo-500/10";
    default:
      return "text-zinc-300 bg-zinc-500/10";
  }
}

export default function AgentTracesPage() {
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // v10.0.23 polish — search box (traceId / label substring) + errors-only toggle.
  const [search, setSearch] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  // v10.0.438 · sort key · 6 modes
  type TraceSort = "newest" | "oldest" | "duration-longest" | "cost-highest" | "calls-most" | "errors-first";
  const [sortKey, setSortKey] = useState<TraceSort>(() => {
    if (typeof window === "undefined") return "newest";
    const saved = window.localStorage.getItem("system-traces:sortKey");
    const valid: TraceSort[] = ["newest", "oldest", "duration-longest", "cost-highest", "calls-most", "errors-first"];
    return saved && valid.includes(saved as TraceSort) ? (saved as TraceSort) : "newest";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("system-traces:sortKey", sortKey);
  }, [sortKey]);

  // Phase B.7a · React Query keys on `{ source }` · switching the
  // source filter refetches automatically. `limit:50` matches the
  // legacy `?limit=50`.
  const tracesQuery = trpc.system.agentTraces.useQuery({
    limit: 50,
    ...(sourceFilter === "all" ? {} : { source: sourceFilter }),
  });
  const data: AgentTracePayload | null =
    (tracesQuery.data as AgentTracePayload | undefined) ?? null;
  const loading = tracesQuery.isPending || tracesQuery.isFetching;
  const error = tracesQuery.error
    ? tracesQuery.error.message
    : null;
  const lastFetched =
    tracesQuery.dataUpdatedAt > 0
      ? new Date(tracesQuery.dataUpdatedAt)
      : null;
  const load = useCallback(() => {
    void tracesQuery.refetch();
  }, [tracesQuery]);

  const toggleExpand = useCallback((id: string) => {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const sourceCounts = useMemo(() => {
    if (!data) return new Map<string, number>();
    const m = new Map<string, number>();
    for (const c of data.chains) {
      m.set(c.rootSource, (m.get(c.rootSource) ?? 0) + 1);
    }
    return m;
  }, [data]);

  // v10.0.23 — apply search + errorsOnly client-side. Server already
  // applied source/limit; these are local refinements over a window.
  const filteredChains = useMemo(() => {
    if (!data) return [];
    const needle = search.trim().toLowerCase();
    const filtered = data.chains.filter((c) => {
      if (errorsOnly && !c.hasError) return false;
      if (!needle) return true;
      if (c.traceId.toLowerCase().includes(needle)) return true;
      if (c.rootLabel.toLowerCase().includes(needle)) return true;
      if (c.children.some((ch) =>
        ch.label.toLowerCase().includes(needle) ||
        (ch.provider ?? "").toLowerCase().includes(needle),
      )) return true;
      return false;
    });
    // v10.0.438 · sort dispatch
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case "oldest":
          return new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime();
        case "duration-longest":
          return b.totalDurationMs - a.totalDurationMs;
        case "cost-highest":
          return b.totalCostCents - a.totalCostCents;
        case "calls-most":
          return b.callCount - a.callCount;
        case "errors-first": {
          const ea = a.hasError ? 0 : 1;
          const eb = b.hasError ? 0 : 1;
          if (ea !== eb) return ea - eb;
          return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
        }
        case "newest":
        default:
          return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
      }
    });
  }, [data, search, errorsOnly, sortKey]);

  // v10.0.23 — sparkline of trace volume over the visible window.
  // 12 buckets across the time span; bucket = count of chains
  // whose startedAt falls inside it. Renders a plain SVG polyline.
  const sparkline = useMemo(() => {
    if (!data || data.chains.length === 0) return null;
    const times = data.chains.map((c) => new Date(c.startedAt).getTime());
    const min = Math.min(...times);
    const max = Math.max(...times);
    const span = Math.max(max - min, 1);
    const buckets = new Array<number>(12).fill(0);
    for (const t of times) {
      const idx = Math.min(11, Math.floor(((t - min) / span) * 12));
      buckets[idx] += 1;
    }
    const peak = Math.max(...buckets, 1);
    return { buckets, peak };
  }, [data]);

  return (
    <StandardPage
      eyebrow="System · v10 Track E.5"
      title="agent traces"
      description="Every AI call, every chain · provider + cost + outcome · Why Nick did X"
      width="2xl"
      rhythm="comfortable"
      actions={
        <FreshnessChip
          lastFetchedAt={lastFetched}
          source="api/system/agent-traces"
          onReload={() => void load()}
        />
      }
    >
      {error && !data && (
        <Panel className="border-rose-500/40 bg-rose-500/[0.05]">
          <p className="p-3 text-[12px] text-rose-200">{error}</p>
        </Panel>
      )}

      {loading && !data && (
        <Panel>
          <p className="p-6 text-center text-[11px] text-zinc-500">
            Loading traces…
          </p>
        </Panel>
      )}

      {data && (
        <>
          {/* ── 5-axis pulse summary · v10.0.223 TrendCounter row ── */}
          {/*    Each axis carries a prior-24h baseline so the operator */}
          {/*    reads 'cost $0.42 (↓ -18% vs prior 24h)' instead of a  */}
          {/*    bare number with no comparison context.                */}
          <Panel>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <TrendCounter
                value={data.stats.chainCount}
                baseline={data.previous?.chainCount ?? null}
                baselineLabel="vs prior 24h"
                label="chains"
                goodWhen="neutral"
                tone="tertiary"
              />
              <TrendCounter
                value={data.stats.totalCalls}
                baseline={data.previous?.totalCalls ?? null}
                baselineLabel="vs prior 24h"
                label="total calls"
                goodWhen="neutral"
                tone="emerald"
              />
              <TrendCounter
                value={data.stats.errorChains}
                baseline={data.previous?.errorChains ?? null}
                baselineLabel="vs prior 24h"
                label="error chains"
                goodWhen="low"
                tone={data.stats.errorChains > 0 ? "rose" : "tertiary"}
              />
              <TrendCounter
                value={data.stats.totalCostCents}
                baseline={data.previous?.totalCostCents ?? null}
                baselineLabel="vs prior 24h"
                label="cost (window)"
                goodWhen="low"
                tone="amber"
                format={(v) => fmtCents(v)}
              />
              <TrendCounter
                value={data.stats.totalDurationMs}
                baseline={data.previous?.totalDurationMs ?? null}
                baselineLabel="vs prior 24h"
                label="latency (window)"
                goodWhen="low"
                tone="tertiary"
                format={(v) => fmtMs(v)}
              />
            </div>
            {/* v10.0.23 sparkline — distribution of chains over the window */}
            {sparkline && (
              <div className="mt-3 flex items-end gap-[2px] h-8">
                {sparkline.buckets.map((b, i) => (
                  <div
                    key={i}
                    title={`bucket ${i + 1}: ${b} chains`}
                    className="flex-1 rounded-t bg-emerald-500/40"
                    style={{
                      height: `${(b / sparkline.peak) * 100}%`,
                      minHeight: b > 0 ? "2px" : "0",
                    }}
                  />
                ))}
              </div>
            )}
          </Panel>

          {/* ── v10.0.23 search + errors-only filter ─────────────── */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              placeholder="search traceId / label / provider…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 min-w-[180px] rounded border border-zinc-700/60 bg-zinc-900/40 px-2 py-1 text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/50"
            />
            <button
              onClick={() => setErrorsOnly((v) => !v)}
              className={cn(
                "rounded border px-2 py-1 text-[10px] font-mono transition",
                errorsOnly
                  ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
                  : "border-zinc-700/50 text-zinc-400 hover:text-zinc-200",
              )}
            >
              {errorsOnly ? "✓ errors only" : "errors only"}
            </button>
            {(search || errorsOnly) && (
              <button
                onClick={() => {
                  setSearch("");
                  setErrorsOnly(false);
                }}
                className="text-[10px] text-zinc-500 hover:text-zinc-200"
              >
                clear
              </button>
            )}
            {/* v10.0.438 · sort dropdown · 6 modes */}
            <SortDropdown<TraceSort>
              value={sortKey}
              onChange={setSortKey}
              defaultValue="newest"
              ariaLabel="Sort traces"
              options={[
                { value: "newest", label: "newest first" },
                { value: "oldest", label: "oldest first" },
                { value: "duration-longest", label: "duration · longest" },
                { value: "cost-highest", label: "cost · highest" },
                { value: "calls-most", label: "calls · most" },
                { value: "errors-first", label: "errors first" },
              ]}
            />
          </div>

          {/* ── Source filter ──────────────────────────────────── */}
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-mono">
            <span className="text-zinc-500">source:</span>
            {(
              [
                "all",
                "chat",
                "cron",
                "autonomous",
                "tool",
                "journal",
                "brain",
                "other",
              ] as const
            ).map((s) => (
              <button
                key={s}
                onClick={() => setSourceFilter(s)}
                className={cn(
                  "rounded px-2 py-1 transition",
                  sourceFilter === s
                    ? "bg-emerald-500/20 text-emerald-200"
                    : "text-zinc-400 hover:text-zinc-200",
                )}
              >
                {s}
                {s !== "all" && sourceCounts.has(s) && (
                  <span className="ml-1 text-zinc-500">
                    ({sourceCounts.get(s)})
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ── Trace chains ───────────────────────────────────── */}
          <Panel>
            <header className="mb-3 flex items-center justify-between">
              <h2 className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">
                recent chains ({filteredChains.length}
                {filteredChains.length !== data.chains.length &&
                  ` of ${data.chains.length}`}
                )
              </h2>
              {data.stats.errorChains > 0 && (
                <span className="text-[10px] text-rose-300">
                  {data.stats.errorChains} chain
                  {data.stats.errorChains !== 1 ? "s" : ""} with errors
                </span>
              )}
            </header>

            {data.chains.length === 0 ? (
              <p className="py-8 text-center text-[11px] text-zinc-500">
                No traces yet — they begin recording on the next AI call.
              </p>
            ) : filteredChains.length === 0 ? (
              <p className="py-8 text-center text-[11px] text-zinc-500">
                No chains match the current filter. Adjust search or
                untoggle errors-only to see all {data.chains.length} chains.
              </p>
            ) : (
              <div className="divide-y divide-zinc-800/40">
                {filteredChains.map((c) => (
                  <div
                    key={c.traceId}
                    className="block w-full py-2.5 text-left transition hover:bg-zinc-800/20"
                  >
                    <button
                      onClick={() => toggleExpand(c.traceId)}
                      className="block w-full text-left"
                    >
                      <div className="flex items-center gap-2 px-2">
                        {c.hasError ? (
                          <AlertTriangle
                            size={11}
                            className="text-rose-300"
                          />
                        ) : (
                          <CheckCircle2
                            size={11}
                            className="text-emerald-300"
                          />
                        )}
                        <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-300">
                          {c.rootLabel}
                        </span>
                        <span
                          className={cn(
                            "rounded px-1.5 py-[1px] text-[9px] uppercase tracking-wider",
                            sourceColor(c.rootSource),
                          )}
                        >
                          {c.rootSource}
                        </span>
                        <span className="text-[10px] tabular-nums text-zinc-500">
                          {c.callCount} call{c.callCount !== 1 ? "s" : ""}
                        </span>
                        <span className="ml-auto flex items-center gap-2 text-[10px] tabular-nums text-zinc-400">
                          <span>{fmtMs(c.totalDurationMs)}</span>
                          <span>·</span>
                          <span>{fmtCents(c.totalCostCents)}</span>
                          <span>·</span>
                          <span>{relTime(c.startedAt)}</span>
                        </span>
                      </div>
                      <div className="px-2 pt-0.5 font-mono text-[9px] text-zinc-600 flex items-center gap-2">
                        <span>{c.traceId}</span>
                        {/* v10.0.149 · drill-down to envelope detail */}
                        <a
                          href={`/system/agent-traces/${c.traceId}`}
                          onClick={(e) => e.stopPropagation()}
                          className="ml-auto text-amber-500/70 hover:text-amber-300 underline decoration-dotted"
                        >
                          envelope →
                        </a>
                      </div>
                    </button>

                    {expanded.has(c.traceId) && (
                      <div className="ml-6 mt-2 space-y-1 border-l border-zinc-800 pl-3">
                        {c.children.map((ch) => (
                          <div
                            key={ch.id}
                            className="flex items-center gap-2 text-[11px]"
                          >
                            {ch.errorClass ? (
                              <AlertTriangle
                                size={10}
                                className="text-rose-300"
                              />
                            ) : (
                              <span className="block h-[6px] w-[6px] rounded-full bg-emerald-400/60" />
                            )}
                            <span className="text-zinc-200">{ch.label}</span>
                            {ch.provider && (
                              <span className="text-[9px] font-mono text-zinc-500">
                                {ch.provider}
                              </span>
                            )}
                            <span className="ml-auto flex items-center gap-2 text-[10px] tabular-nums text-zinc-500">
                              <span>{fmtMs(ch.durationMs)}</span>
                              <span>·</span>
                              <span>{fmtCents(ch.costCents)}</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <p className="text-center text-[10px] text-zinc-600">
            Generated {new Date(data.generatedAt).toLocaleString()} · v10 E.5 ·
            see <code>lib/ai/agent-trace.ts</code> for the contract
          </p>
        </>
      )}
    </StandardPage>
  );
}

function SummaryCell({
  icon,
  label,
  value,
  fmt,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  fmt?: (v: number) => string;
  color: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider text-zinc-500">
        {icon}
        {label}
      </div>
      <div className={cn("text-2xl font-bold tabular-nums", color)}>
        {fmt ? (
          <span>{fmt(value)}</span>
        ) : (
          <AnimatedCounter value={value} />
        )}
      </div>
    </div>
  );
}
