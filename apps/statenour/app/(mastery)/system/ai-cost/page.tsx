"use client";

/**
 * /system/ai-cost — historical cost breakdowns + 14d trend.
 *
 * v11.0 (W2.4). Aggregates AiGeneration across today · 7d · 30d with a
 * 14-day daily trend sparkline, breakdowns by feature + model, plus a
 * burn-rate projection — the canonical answer to "where did the tokens
 * go".
 *
 * Alive elements:
 *   · animated count-up on total cost
 *   · gradient bar chart for 14-day trend
 *   · burn-rate indicator (today vs 7d avg)
 *   · error-rate pulse when > 5%
 *   · auto-refresh 60s
 *
 * Future knobs (W11):
 *   · daily cost cap (writes OperatorPreference)
 *   · provider override pin
 *   · strict mode (refuse calls > $X estimate)
 */

import { useState, useMemo } from "react";
import { Panel } from "@/components/panel";
import { StandardPage } from "@/components/layout/standard-page";
import { cn } from "@/lib/utils/cn";
import { TrendCounter } from "@/components/ui/trend-counter";
import { trpc } from "@/lib/trpc/client";
import { LaneBudgets } from "@/components/system/lane-budgets";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/lib/trpc/root";

// Phase Y.2 (2026-05-18 PM) · types now inferred from the system
// router so the manual Breakdown/WindowAgg/Feed mirrors are gone.
type Feed = inferRouterOutputs<AppRouter>["system"]["aiCost"];
type Breakdown = Feed["today"]["byFeature"][number];

type Window = "today" | "7d" | "30d";

function dollars(cents: number): string {
  if (cents === 0) return "$0.00";
  if (cents < 100) return `$${(cents / 100).toFixed(2)}`;
  return `$${(cents / 100).toFixed(2)}`;
}

function TrendBars({ trend }: { trend: Feed["trend"] }) {
  const max = Math.max(...trend.map((t) => t.costCents), 1);
  return (
    <div className="flex h-20 items-end gap-1">
      {trend.map((t) => {
        const h = Math.max(4, Math.round((t.costCents / max) * 76));
        const today = t.day === new Date().toISOString().slice(0, 10);
        return (
          <div key={t.day} className="group flex flex-1 flex-col items-center gap-1">
            <div className="relative w-full">
              <div
                className={cn(
                  "w-full rounded-sm transition-all",
                  today ? "bg-gradient-to-t from-emerald-500 to-emerald-300" : "bg-gradient-to-t from-sky-700 to-sky-400",
                  "group-hover:from-violet-600 group-hover:to-violet-300",
                )}
                style={{ height: `${h}px` }}
                title={`${t.day} · ${dollars(t.costCents)} · ${t.calls} calls`}
              />
            </div>
            <span className="hidden text-[9px] text-zinc-600 sm:block">{t.day.slice(5)}</span>
          </div>
        );
      })}
    </div>
  );
}

function BreakdownTable({ rows, total }: { rows: Breakdown[]; total: number }) {
  if (rows.length === 0) {
    return <p className="text-xs text-zinc-500">no data in window</p>;
  }
  const maxCost = Math.max(...rows.map((r) => r.costCents), 1);
  return (
    <div className="space-y-1">
      {rows.slice(0, 10).map((r) => {
        const pct = total > 0 ? Math.round((r.costCents / total) * 100) : 0;
        const barW = Math.max(2, Math.round((r.costCents / maxCost) * 100));
        return (
          <div key={r.key} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 rounded px-2 py-1.5 transition hover:bg-white/[0.03]">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate font-mono text-xs text-zinc-200">{r.key}</span>
                <span className="flex-shrink-0 text-[10px] text-zinc-500">{r.calls} calls</span>
              </div>
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-zinc-900">
                <div
                  className={cn(
                    "h-full rounded-full",
                    r.errorRate > 20 ? "bg-rose-500" : r.errorRate > 5 ? "bg-amber-500" : "bg-emerald-500",
                  )}
                  style={{ width: `${barW}%` }}
                />
              </div>
            </div>
            <div className="text-right font-mono text-xs tabular-nums text-zinc-100">{dollars(r.costCents)}</div>
            <div className="text-right text-[10px] text-zinc-500 tabular-nums">{pct}%</div>
            <div className={cn(
              "text-right text-[10px] tabular-nums",
              r.errorRate > 20 ? "text-rose-400" : r.errorRate > 5 ? "text-amber-400" : "text-zinc-500",
            )}>
              {r.avgLatencyMs}ms {r.errorRate > 0 ? `· ${r.errorRate}% err` : ""}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function AiCostPage() {
  const [window, setWindow] = useState<Window>("7d");

  // Phase Y.2 · React Query · 60s refetch + abort handling built-in ·
  // no more manual AbortController dance.
  const { data: feed, isFetching: loading, refetch } =
    trpc.system.aiCost.useQuery(undefined, {
      refetchInterval: 60_000,
      staleTime: 30_000,
    });
  const load = () => void refetch();

  const active = feed ? (window === "today" ? feed.today : window === "7d" ? feed.last7d : feed.last30d) : null;

  const burnRate = useMemo(() => {
    if (!feed) return null;
    const todayCost = feed.today.totalCostCents;
    const avg7d = feed.last7d.totalCostCents / 7;
    if (avg7d === 0) return null;
    const ratio = todayCost / avg7d;
    if (ratio > 1.5) return { label: "hot", tint: "text-rose-400", ratio };
    if (ratio > 1.1) return { label: "above avg", tint: "text-amber-400", ratio };
    if (ratio < 0.5) return { label: "quiet", tint: "text-sky-300", ratio };
    return { label: "normal", tint: "text-emerald-400", ratio };
  }, [feed]);

  return (
    <StandardPage
      eyebrow="NOUR OS · System"
      title="ai cost"
      description={
        feed
          ? `today ${dollars(feed.today.totalCostCents)} · 7d ${dollars(feed.last7d.totalCostCents)} · 30d ${dollars(feed.last30d.totalCostCents)}`
          : "loading…"
      }
      width="2xl"
      rhythm="loose"
      actions={
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="rounded-lg border border-[var(--border-hover)] bg-[var(--bg-raised)]/5 px-4 py-2 text-xs font-medium text-[var(--text-secondary)] transition hover:bg-[var(--bg-raised)]/10 disabled:opacity-50"
          >
            {loading ? "refreshing…" : "refresh"}
          </button>
        </div>
      }
    >

      {/* v10.0.219 · Headline grid uses TrendCounter so each metric
          carries its own baseline. When window=today we compare against
          the 7d avg/day; otherwise the baselines collapse to null and
          the cards read as plain values (no fake comparison). The trend
          history feeds the inline sparkline straight from feed.trend. */}
      {feed && active && (
        <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02]">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <TrendCounter
              value={active.totalCostCents}
              baseline={
                window === "today" && feed.last7d.totalCostCents > 0
                  ? Math.round(feed.last7d.totalCostCents / 7)
                  : null
              }
              baselineLabel={window === "today" ? "vs 7d avg/day" : undefined}
              history={feed.trend.slice(-7).map((t) => t.costCents)}
              label={window === "today" ? "today · cost ¢" : `${window} · cost ¢`}
              goodWhen="low"
              tone="emerald"
              format={(n) => `$${(n / 100).toFixed(2)}`}
            />
            <TrendCounter
              value={active.totalCalls}
              baseline={
                window === "today" && feed.last7d.totalCalls > 0
                  ? Math.round(feed.last7d.totalCalls / 7)
                  : null
              }
              baselineLabel={window === "today" ? "vs 7d avg/day" : undefined}
              history={feed.trend.slice(-7).map((t) => t.calls)}
              label="calls"
              goodWhen="neutral"
              tone="gold"
            />
            <TrendCounter
              value={Math.round(active.avgLatencyMs)}
              baseline={
                window === "today" && feed.last7d.avgLatencyMs > 0
                  ? Math.round(feed.last7d.avgLatencyMs)
                  : null
              }
              baselineLabel={window === "today" ? "vs 7d" : undefined}
              label="avg latency · ms"
              goodWhen="low"
              tone="tertiary"
              format={(n) => `${Math.round(n)}ms`}
            />
            <TrendCounter
              value={active.errorRate}
              baseline={
                window === "today" && feed.last7d.totalCalls > 0
                  ? feed.last7d.errorRate
                  : null
              }
              baselineLabel={window === "today" ? "vs 7d" : undefined}
              label="error rate"
              goodWhen="low"
              tone={
                active.errorRate > 10 ? "rose"
                : active.errorRate > 5 ? "amber"
                : active.errorRate > 0 ? "emerald"
                : "tertiary"
              }
              format={(n) => `${n.toFixed(1)}%`}
            />
          </div>
          {burnRate && (
            <div className="mt-3 flex items-baseline justify-between border-t border-[var(--border-soft)]/50 pt-2.5">
              <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-zinc-500">
                burn rate · today
              </span>
              <span className="flex items-baseline gap-2">
                <span className={cn("font-mono text-xl font-bold tabular-nums", burnRate.tint)}>
                  {burnRate.ratio.toFixed(1)}×
                </span>
                <span className="text-[10px] text-zinc-500">{burnRate.label}</span>
              </span>
            </div>
          )}
        </Panel>
      )}

      {/* Window pills */}
      <div className="flex flex-wrap gap-2">
        {(["today", "7d", "30d"] as Window[]).map((w) => (
          <button
            key={w}
            onClick={() => setWindow(w)}
            className={cn(
              "rounded-full px-3 py-1 text-xs transition",
              window === w
                ? "bg-emerald-500/15 text-emerald-200"
                : "bg-zinc-900/60 text-zinc-400 hover:bg-zinc-800/60",
            )}
          >
            {w}
          </button>
        ))}
      </div>

      {/* 14-day trend */}
      {feed && (
        <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02]">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">14-day trend</h2>
            <span className="text-xs text-zinc-500">
              max day · {dollars(Math.max(...feed.trend.map((t) => t.costCents)))}
            </span>
          </div>
          <TrendBars trend={feed.trend} />
        </Panel>
      )}

      {/* U6 · per-lane spend vs cap (deterministic stops) */}
      <LaneBudgets />

      {/* Breakdowns */}
      {feed && active && (
        <div className="grid gap-4 md:grid-cols-2">
          <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02]">
            <h2 className="mb-3 text-sm font-semibold text-white">by feature · top 10</h2>
            <BreakdownTable rows={active.byFeature} total={active.totalCostCents} />
          </Panel>
          <Panel className="border-[var(--border-default)] bg-[var(--bg-raised)]/[0.02]">
            <h2 className="mb-3 text-sm font-semibold text-white">by model · top 10</h2>
            <BreakdownTable rows={active.byModel} total={active.totalCostCents} />
          </Panel>
        </div>
      )}

      <p className="pt-2 text-center text-[10px] text-zinc-600">
        auto-refresh 60s · source: AiGeneration · writes come from lib/ai/track.ts
      </p>
    </StandardPage>
  );
}
