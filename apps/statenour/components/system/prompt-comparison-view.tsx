"use client";

/**
 * PromptComparisonView · v10.0.307 · prompt v1↔v2 comparison tab on
 * /system/prompt (absorbed from /system/prompt-comparison which is
 * deleted).
 *
 * Operator dashboard for comparing legacy `buildSystemPrompt()` (v1)
 * to v9.0 `buildSystemPromptV2()` flag-gated builder. Side-by-side
 * rendering, size delta, section coverage checklist.
 *
 * Closes the v9.1 shadow-comparison story for operator-on-demand
 * inspection. Flip NICK_PRIME_PROMPT=1 once v2 covers v1 signals.
 */

import { Panel } from "@/components/panel";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { trpc } from "@/lib/trpc/client";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ComparePayload {
  generatedAt: string;
  v1: {
    prompt: string;
    chars: number;
    lines: number;
    sectionHeadings: string[];
  };
  v2: {
    prompt: string;
    chars: number;
    lines: number;
    sectionHeadings: string[];
    builderVersion: string;
  };
  delta: {
    charsDelta: number;
    charsDeltaPct: number;
    sectionsOnlyInV1: string[];
    sectionsOnlyInV2: string[];
    sectionsInBoth: string[];
  };
}

interface TrendPoint {
  id: string;
  value: number;
  tags: Record<string, unknown>;
  createdAt: string;
}

interface TrendPayload {
  generatedAt: string;
  windowDays: number;
  summary: {
    sampleCount: number;
    sampleCount24h: number;
    avgPct24h: number | null;
    latestPct: number | null;
    latestAt: string | null;
  };
  series: {
    charsDelta: TrendPoint[];
    charsDeltaPct: TrendPoint[];
    sectionsOnlyInV1: TrendPoint[];
  };
}

export function PromptComparisonView() {
  // Phase VV (2026-05-22) · REST→tRPC · the side-by-side compare and the
  // 7-day shadow trend are two typed queries (system.promptCompare +
  // system.promptShadowTrend). Both legacy routes returned their payload
  // directly (no `{data}` wrap). The trend query is best-effort — the
  // prior code only rendered the trend strip when it loaded OK, so a
  // trend error is swallowed here too (compare drives the error state).
  // FreshnessChip's timestamp comes from the compare query's
  // dataUpdatedAt; reload re-fetches both.
  const compareQuery = trpc.system.promptCompare.useQuery();
  const trendQuery = trpc.system.promptShadowTrend.useQuery({ days: 7 });
  const data: ComparePayload | null = compareQuery.data ?? null;
  const trend: TrendPayload | null = trendQuery.data ?? null;
  const loading = compareQuery.isPending;
  const error = compareQuery.error
    ? compareQuery.error.message || "fetch failed"
    : null;
  const lastFetched = compareQuery.dataUpdatedAt
    ? new Date(compareQuery.dataUpdatedAt)
    : null;
  const load = () => {
    void compareQuery.refetch();
    void trendQuery.refetch();
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <FreshnessChip
          lastFetchedAt={lastFetched}
          source="api/system/prompt-compare"
          onReload={() => void load()}
        />
      </div>

      {error && !data && (
        <Panel className="border-rose-500/40 bg-rose-500/[0.05]">
          <p className="p-3 text-[12px] text-rose-200">{error}</p>
        </Panel>
      )}

      {loading && !data && (
        <Panel>
          <p className="p-6 text-center text-[11px] text-zinc-500">
            Building both prompts (full DB read for each)…
          </p>
        </Panel>
      )}

      {data && (
        <>
          {/* ── Size delta + section coverage ────────────────────── */}
          <Panel>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <div className="text-[9px] font-mono uppercase tracking-wider text-zinc-500">
                  v1 size
                </div>
                <div className="text-2xl font-bold tabular-nums text-zinc-200">
                  <AnimatedCounter value={data.v1.chars} />
                  <span className="ml-1 text-[10px] font-normal text-zinc-500">
                    chars · {data.v1.lines} lines · {data.v1.sectionHeadings.length} sections
                  </span>
                </div>
              </div>
              <div>
                <div className="text-[9px] font-mono uppercase tracking-wider text-zinc-500">
                  v2 size
                </div>
                <div className="text-2xl font-bold tabular-nums text-zinc-200">
                  <AnimatedCounter value={data.v2.chars} />
                  <span className="ml-1 text-[10px] font-normal text-zinc-500">
                    chars · {data.v2.lines} lines · {data.v2.sectionHeadings.length} sections
                  </span>
                </div>
              </div>
              <div>
                <div className="text-[9px] font-mono uppercase tracking-wider text-zinc-500">
                  delta
                </div>
                <div
                  className={cn(
                    "text-2xl font-bold tabular-nums",
                    data.delta.charsDelta < 0 ? "text-emerald-300" : "text-amber-300",
                  )}
                >
                  {data.delta.charsDelta >= 0 ? "+" : ""}
                  <AnimatedCounter value={data.delta.charsDelta} />
                  <span className="ml-1 text-[10px] font-normal opacity-80">
                    chars ({data.delta.charsDeltaPct >= 0 ? "+" : ""}
                    {data.delta.charsDeltaPct}%)
                  </span>
                </div>
              </div>
            </div>
          </Panel>

          {/* ── v9.1.6 · 7-day shadow trend ───────────────────── */}
          {trend && trend.summary.sampleCount > 0 && (
            <Panel>
              <header className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">
                    7-day shadow trend
                  </h2>
                  <p className="mt-1 text-[11px] text-zinc-500">
                    Each point = one chat reply built in shadow mode. Lower
                    delta-pct + fewer sections-only-in-v1 = closer to flip-on.
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-[9px] font-mono uppercase tracking-wider text-zinc-500">
                    Last 24h avg
                  </div>
                  <div
                    className={cn(
                      "text-lg font-bold tabular-nums",
                      trend.summary.avgPct24h == null
                        ? "text-zinc-500"
                        : Math.abs(trend.summary.avgPct24h) < 5
                          ? "text-emerald-300"
                          : "text-amber-300",
                    )}
                  >
                    {trend.summary.avgPct24h == null
                      ? "—"
                      : `${trend.summary.avgPct24h >= 0 ? "+" : ""}${trend.summary.avgPct24h}%`}
                  </div>
                  <div className="text-[9px] text-zinc-600">
                    {trend.summary.sampleCount24h} sample(s)
                  </div>
                </div>
              </header>
              <div className="grid gap-3 sm:grid-cols-3">
                <Sparkline
                  label="chars delta (v2-v1)"
                  points={trend.series.charsDelta}
                  formatValue={(v) => `${v >= 0 ? "+" : ""}${Math.round(v)}`}
                />
                <Sparkline
                  label="delta % of v1"
                  points={trend.series.charsDeltaPct}
                  formatValue={(v) => `${v >= 0 ? "+" : ""}${Math.round(v * 10) / 10}%`}
                />
                <Sparkline
                  label="sections only in v1"
                  points={trend.series.sectionsOnlyInV1}
                  formatValue={(v) => `${Math.round(v)}`}
                />
              </div>
            </Panel>
          )}

          {/* ── Section coverage checklist ──────────────────────── */}
          <Panel>
            <header className="mb-3">
              <h2 className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">
                Section coverage
              </h2>
              <p className="mt-1 text-[11px] text-zinc-500">
                v2 should eventually cover every section v1 carries. Sections only
                in v1 are migration targets; sections only in v2 are intentional v9
                additions (proof, command spine, etc).
              </p>
            </header>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-[10px] font-mono uppercase tracking-wider text-amber-300">
                  Only in v1 ({data.delta.sectionsOnlyInV1.length}) · migration backlog
                </p>
                {data.delta.sectionsOnlyInV1.length === 0 ? (
                  <p className="text-[11px] text-emerald-300">Parity achieved 🎯</p>
                ) : (
                  <ul className="space-y-0.5">
                    {data.delta.sectionsOnlyInV1.map((s, i) => (
                      <li
                        key={i}
                        className="flex items-center gap-1.5 text-[11px] text-amber-200"
                      >
                        <X size={11} />
                        <span className="truncate">{s}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <p className="mb-1 text-[10px] font-mono uppercase tracking-wider text-emerald-300">
                  In both ({data.delta.sectionsInBoth.length})
                </p>
                <ul className="space-y-0.5">
                  {data.delta.sectionsInBoth.map((s, i) => (
                    <li
                      key={i}
                      className="flex items-center gap-1.5 text-[11px] text-emerald-200"
                    >
                      <Check size={11} />
                      <span className="truncate">{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {data.delta.sectionsOnlyInV2.length > 0 && (
              <div className="mt-3">
                <p className="mb-1 text-[10px] font-mono uppercase tracking-wider text-sky-300">
                  Only in v2 ({data.delta.sectionsOnlyInV2.length}) · v9 additions
                </p>
                <ul className="space-y-0.5">
                  {data.delta.sectionsOnlyInV2.map((s, i) => (
                    <li
                      key={i}
                      className="flex items-center gap-1.5 text-[11px] text-sky-200"
                    >
                      <Check size={11} />
                      <span className="truncate">{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>

          {/* ── Side-by-side text ──────────────────────────────── */}
          <div className="grid gap-3 lg:grid-cols-2">
            <Panel>
              <header className="mb-2 flex items-center justify-between">
                <h2 className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">
                  v1 — legacy buildSystemPrompt()
                </h2>
              </header>
              <pre className="max-h-[600px] overflow-auto rounded border border-zinc-800 bg-zinc-950/40 p-3 text-[10px] font-mono leading-tight text-zinc-300 whitespace-pre-wrap break-words">
                {data.v1.prompt}
              </pre>
            </Panel>

            <Panel>
              <header className="mb-2 flex items-center justify-between">
                <h2 className="text-[10px] font-mono uppercase tracking-wider text-zinc-400">
                  v2 — buildSystemPromptV2() · {data.v2.builderVersion}
                </h2>
              </header>
              <pre className="max-h-[600px] overflow-auto rounded border border-emerald-500/20 bg-emerald-500/[0.02] p-3 text-[10px] font-mono leading-tight text-zinc-200 whitespace-pre-wrap break-words">
                {data.v2.prompt}
              </pre>
            </Panel>
          </div>

          <p className="text-center text-[10px] text-zinc-600">
            Generated {new Date(data.generatedAt).toLocaleString()} · click reload to
            rebuild · flip NICK_PRIME_PROMPT=1 in your env once parity holds for 7+ days
          </p>
        </>
      )}
    </div>
  );
}

/**
 * v9.1.6 · Inline SVG sparkline for the 7-day shadow trend strip.
 * Stays purely client-side and zero-dependency — Recharts would force
 * a chunk download for a tiny 3-spark widget.
 */
function Sparkline({
  label,
  points,
  formatValue,
}: {
  label: string;
  points: TrendPoint[];
  formatValue: (v: number) => string;
}) {
  const empty = points.length === 0;
  const last = points[points.length - 1];

  // Single-point series can't draw a line — short-circuit.
  if (empty || points.length < 2) {
    return (
      <div className="rounded border border-zinc-800/60 bg-zinc-950/30 p-2">
        <div className="flex items-baseline justify-between">
          <span className="text-[9px] font-mono uppercase tracking-wider text-zinc-500">
            {label}
          </span>
          <span className="text-[10px] tabular-nums text-zinc-400">
            {empty ? "—" : formatValue(last!.value)}
          </span>
        </div>
        <div className="mt-1 h-8 text-[9px] text-zinc-600 flex items-center justify-center">
          {empty ? "no shadow runs yet" : "1 sample"}
        </div>
      </div>
    );
  }

  const width = 200;
  const height = 32;
  const values = points.map((p) => p.value);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const range = max - min || 1;
  const stepX = width / (points.length - 1);
  const path = points
    .map((p, i) => {
      const x = i * stepX;
      const y = height - ((p.value - min) / range) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  const lastY = height - ((last!.value - min) / range) * height;
  const lastX = (points.length - 1) * stepX;

  return (
    <div className="rounded border border-zinc-800/60 bg-zinc-950/30 p-2">
      <div className="flex items-baseline justify-between">
        <span className="text-[9px] font-mono uppercase tracking-wider text-zinc-500">
          {label}
        </span>
        <span className="text-[10px] tabular-nums text-zinc-300">
          {formatValue(last!.value)}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="mt-1 h-8 w-full"
      >
        {/* zero baseline */}
        <line
          x1={0}
          x2={width}
          y1={height - ((0 - min) / range) * height}
          y2={height - ((0 - min) / range) * height}
          stroke="currentColor"
          strokeWidth={0.5}
          className="text-zinc-700"
        />
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.25}
          className="text-emerald-400"
        />
        <circle cx={lastX} cy={lastY} r={1.6} className="fill-emerald-300" />
      </svg>
      <div className="mt-0.5 text-[9px] text-zinc-600">
        {points.length} samples · range {formatValue(min)} → {formatValue(max)}
      </div>
    </div>
  );
}
