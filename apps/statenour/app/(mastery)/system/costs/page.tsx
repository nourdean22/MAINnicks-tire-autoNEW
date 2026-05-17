"use client";

/**
 * /system/costs — CANONICAL cost dashboard.
 *
 * v6 · BATCH 2 · Apr 28. v10.0.80 · standardized as the canonical entry
 * for "what is AI costing me / what's hurting reliability right now".
 * Forward-looking surface: live provider health, per-model latency,
 * budget gauge, slow/error sidebars.
 *
 *   ─ Provider-health ribbon (Venice / Ollama / OpenAI / Anthropic)
 *     · live availability + cooldown remaining + tool-call support
 *     · recent errors per lane (last hour)
 *
 *   ─ Per-model latency leaderboard (p50 / p95 / p99 / errors / avg)
 *     · sortable; slow models (p95 > 5s) badged red
 *     · click-through to filter cost dashboard
 *
 *   ─ Daily budget gauge — animated dial, today vs limit
 *
 *   ─ Image vs chat split (today only)
 *     · so the burn shape is honest — image gen costs a lot per call
 *       even though it's < 5% of total calls
 *
 *   ─ Slow-model + error-prone-model sidebars — "what's hurting us right now"
 *
 * Sister surface: /system/ai-cost (deep historical breakdowns by
 * feature + model + 14-day trend sparkline + burn-rate projection).
 * Cross-link in the header lets you flip between live + historical.
 *
 * Auth: session cookie. Refresh: 30s.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import { Panel } from "@/components/panel";
import { StandardPage } from "@/components/layout/standard-page";
import { cn } from "@/lib/utils/cn";
import { AlertCircle, Activity, Zap, Image as ImageIcon, Server, Wrench, Gauge, Target, BarChart3 } from "lucide-react";
import { Sparkline } from "@/components/ui/sparkline";

import { authedFetch } from "@/hooks/use-authed-fetch";
interface ProviderHealth {
  name: "venice" | "ollama" | "openai" | "anthropic" | "emergency";
  configured: boolean;
  available: boolean;
  modelId: string;
  quotaExhausted: boolean;
  quotaCooldownRemainingMs: number;
  toolsSupported: boolean;
  recentCalls: number;
  recentErrors: number;
  errorRate: number;
  avgLatencyMs: number;
}

interface ModelLatency {
  model: string;
  calls: number;
  errors: number;
  errorRate: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  avgMs: number;
  maxMs: number;
  totalCostCents: number;
}

interface CostsResponse {
  ok: boolean;
  window: { days: number };
  buildMs: number;
  budget: {
    spent: number;
    limit: number;
    remaining: number;
    percentUsed: number;
    overBudget: boolean;
  };
  health: {
    providers: ProviderHealth[];
    overallTone: "green" | "amber" | "red";
    pillLabel: string;
    rateLimit: {
      buckets: Array<{ name: string; windowMs: number; max: number }>;
    };
  };
  usage: {
    totalGenerations: number;
    totalCostCents: number;
    totalPromptTokens: number;
    totalOutputTokens: number;
  };
  latency: ModelLatency[];
  latencyTrend?: Array<{
    model: string;
    buckets: Array<{ day: string; calls: number; p50Ms: number; p95Ms: number }>;
  }>;
  calibration?: {
    totalPredictions: number;
    resolvedCount: number;
    pendingCount: number;
    meanErrorPct: number;
    within20PctRate: number;
    within40PctRate: number;
    meanBiasPct: number;
  } | null;
  slowestModels: ModelLatency[];
  errorProneModels: ModelLatency[];
  toolSupport: Array<{ model: string; calls: number; supportsTools: boolean }>;
  imageVsChat: {
    imageCalls: number;
    imageCostCents: number;
    chatCalls: number;
    chatCostCents: number;
  };
}

function dollars(cents: number): string {
  if (cents === 0) return "$0.00";
  return `$${(cents / 100).toFixed(2)}`;
}

function ms(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
  return `${value}ms`;
}

function latencyTone(p95: number): string {
  if (p95 > 5000) return "text-rose-300 font-semibold";
  if (p95 > 2000) return "text-amber-300";
  if (p95 > 800) return "text-sky-300";
  return "text-emerald-300";
}

function providerTone(p: ProviderHealth): string {
  if (!p.configured) return "border-zinc-700/40 bg-zinc-900/40 text-zinc-500";
  if (!p.available) return "border-amber-500/40 bg-amber-500/5 text-amber-200";
  if (p.errorRate > 0.2) return "border-rose-500/40 bg-rose-500/5 text-rose-200";
  return "border-emerald-500/30 bg-emerald-500/[0.04] text-emerald-200";
}

export default function SystemCostsPage() {
  const [data, setData] = useState<CostsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(7);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch(`/api/system/costs?days=${days}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as CostsResponse;
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
    const i = setInterval(load, 30_000);
    return () => clearInterval(i);
  }, [load]);

  const burnRate = useMemo(() => {
    if (!data) return null;
    const limit = data.budget.limit;
    if (limit <= 0) return null;
    const pct = data.budget.percentUsed;
    if (pct >= 100) return { tint: "text-rose-300", label: "OVER" };
    if (pct >= 80) return { tint: "text-amber-300", label: "burning" };
    if (pct >= 50) return { tint: "text-sky-300", label: "active" };
    return { tint: "text-emerald-300", label: "calm" };
  }, [data]);

  return (
    <StandardPage
      eyebrow="NOUR OS · System"
      title="AI Costs & Health"
      description={
        data
          ? `${data.health.pillLabel} · ${data.latency.length} models tracked · last ${days}d`
          : "loading…"
      }
      width="3xl"
      rhythm="comfortable"
      actions={
        <div className="flex items-center gap-2">
          {/* v10.0.80 · cross-link to historical analytics sister page */}
          <Link
            href="/system/ai-cost"
            className="hidden sm:flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.02] px-2.5 py-1.5 text-xs text-zinc-300 transition hover:bg-white/[0.06] hover:text-zinc-100"
            title="Historical: by-feature / by-model / 14d trend / burn-rate projection"
          >
            <BarChart3 className="h-3.5 w-3.5" />
            <span>historical →</span>
          </Link>
          <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.02] p-1 text-xs">
            {[1, 7, 30].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={cn(
                  "rounded-md px-2 py-1 transition-colors",
                  days === d
                    ? "bg-white/10 text-white"
                    : "text-zinc-400 hover:bg-white/5",
                )}
              >
                {d === 1 ? "today" : `${d}d`}
              </button>
            ))}
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-white/[0.06] disabled:opacity-50"
          >
            {loading ? "…" : "refresh"}
          </button>
        </div>
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

      {/* Provider health ribbon */}
      {data && (
        <Panel>
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-white">
            <Server className="h-4 w-4" /> provider lanes
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {data.health.providers.map((p) => (
              <div
                key={p.name}
                className={cn(
                  "rounded-lg border p-3 transition",
                  providerTone(p),
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="font-mono text-xs uppercase tracking-wider">{p.name}</div>
                  <div
                    className={cn(
                      "h-2 w-2 rounded-full",
                      p.available
                        ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]"
                        : p.configured
                          ? "bg-amber-400"
                          : "bg-zinc-600",
                    )}
                  />
                </div>
                <div className="mt-1 truncate font-mono text-[10px] opacity-70" title={p.modelId}>
                  {p.modelId || "—"}
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1 text-[10px]">
                  <div>
                    <div className="opacity-60">calls/h</div>
                    <div className="font-semibold tabular-nums">{p.recentCalls}</div>
                  </div>
                  <div>
                    <div className="opacity-60">err</div>
                    <div className="font-semibold tabular-nums">
                      {(p.errorRate * 100).toFixed(0)}%
                    </div>
                  </div>
                  <div>
                    <div className="opacity-60">avg</div>
                    <div className="font-semibold tabular-nums">{ms(p.avgLatencyMs)}</div>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {p.toolsSupported ? (
                    <span className="inline-flex items-center gap-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9px]">
                      <Wrench className="h-2.5 w-2.5" /> tools
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[9px]">
                      no tools
                    </span>
                  )}
                  {p.quotaExhausted && (
                    <span className="inline-flex items-center gap-0.5 rounded-full border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-[9px]">
                      cooldown
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      {/* Top stats */}
      {data && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <StatTile
            icon={<Gauge className="h-4 w-4" />}
            label="daily budget"
            value={`${data.budget.percentUsed}%`}
            sub={`${dollars(data.budget.spent)} / ${dollars(data.budget.limit)}`}
            tone={burnRate?.tint ?? "text-zinc-300"}
          />
          <StatTile
            icon={<Activity className="h-4 w-4" />}
            label={`window · ${days}d`}
            value={dollars(data.usage.totalCostCents)}
            sub={`${data.usage.totalGenerations.toLocaleString()} calls`}
            tone="text-emerald-300"
          />
          <StatTile
            icon={<ImageIcon className="h-4 w-4" />}
            label="today · image"
            value={dollars(data.imageVsChat.imageCostCents)}
            sub={`${data.imageVsChat.imageCalls} renders`}
            tone="text-violet-300"
          />
          <StatTile
            icon={<Zap className="h-4 w-4" />}
            label="today · chat"
            value={dollars(data.imageVsChat.chatCostCents)}
            sub={`${data.imageVsChat.chatCalls} turns`}
            tone="text-sky-300"
          />
        </div>
      )}

      {/* v7 · BATCH 2H — Calibration tile */}
      {data?.calibration && data.calibration.resolvedCount > 0 && (
        <Panel>
          <div className="flex items-center gap-2 mb-2">
            <Target className="h-4 w-4 text-violet-300" />
            <h2 className="text-sm font-semibold text-white">prediction calibration · last 30d</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <CalibTile label="resolved" value={data.calibration.resolvedCount} sub={`${data.calibration.pendingCount} pending`} tone="text-zinc-200" />
            <CalibTile
              label="within ±20%"
              value={`${(data.calibration.within20PctRate * 100).toFixed(0)}%`}
              sub="accuracy"
              tone={data.calibration.within20PctRate >= 0.6 ? "text-emerald-300" : data.calibration.within20PctRate >= 0.4 ? "text-amber-300" : "text-rose-300"}
            />
            <CalibTile
              label="within ±40%"
              value={`${(data.calibration.within40PctRate * 100).toFixed(0)}%`}
              sub="looser bar"
              tone="text-sky-300"
            />
            <CalibTile
              label="mean error"
              value={`${(data.calibration.meanErrorPct * 100).toFixed(0)}%`}
              sub="of predicted"
              tone="text-zinc-300"
            />
            <CalibTile
              label="bias"
              value={`${data.calibration.meanBiasPct >= 0 ? "+" : ""}${(data.calibration.meanBiasPct * 100).toFixed(0)}%`}
              sub={data.calibration.meanBiasPct > 0.1 ? "under-promises" : data.calibration.meanBiasPct < -0.1 ? "over-promises" : "well-calibrated"}
              tone={Math.abs(data.calibration.meanBiasPct) < 0.1 ? "text-emerald-300" : "text-amber-300"}
            />
          </div>
        </Panel>
      )}

      {/* Latency leaderboard */}
      {data && data.latency.length > 0 && (
        <Panel>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">per-model latency</h2>
            <span className="text-[10px] text-zinc-500">
              p95 &gt; 5s = red · &gt; 2s = amber · &gt; 800ms = sky · ≤ 800ms = green
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-zinc-500">
                <tr>
                  <th className="px-2 py-2 text-left font-medium">model</th>
                  <th className="px-2 py-2 text-right font-medium">calls</th>
                  <th className="px-2 py-2 text-right font-medium">p50</th>
                  <th className="px-2 py-2 text-right font-medium">p95</th>
                  <th className="px-2 py-2 text-right font-medium">p99</th>
                  <th className="px-2 py-2 text-right font-medium">max</th>
                  <th className="px-2 py-2 text-right font-medium">err</th>
                  <th className="px-2 py-2 text-right font-medium">spend</th>
                  <th className="px-2 py-2 text-center font-medium">trend</th>
                  <th className="px-2 py-2 text-center font-medium">tools</th>
                </tr>
              </thead>
              <tbody>
                {data.latency.map((m) => {
                  const supports =
                    data.toolSupport.find((t) => t.model === m.model)?.supportsTools ?? true;
                  return (
                    <tr
                      key={m.model}
                      className={cn(
                        "border-t border-white/5 hover:bg-white/[0.02]",
                        m.errorRate > 0.2 && "bg-rose-500/[0.04]",
                      )}
                    >
                      <td className="px-2 py-1.5 font-mono text-zinc-200">{m.model}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-zinc-400">{m.calls}</td>
                      <td className={cn("px-2 py-1.5 text-right tabular-nums", latencyTone(m.p50Ms))}>
                        {ms(m.p50Ms)}
                      </td>
                      <td className={cn("px-2 py-1.5 text-right tabular-nums", latencyTone(m.p95Ms))}>
                        {ms(m.p95Ms)}
                      </td>
                      <td className={cn("px-2 py-1.5 text-right tabular-nums", latencyTone(m.p99Ms))}>
                        {ms(m.p99Ms)}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-zinc-500">
                        {ms(m.maxMs)}
                      </td>
                      <td
                        className={cn(
                          "px-2 py-1.5 text-right tabular-nums",
                          m.errorRate > 0.2
                            ? "text-rose-300"
                            : m.errorRate > 0.05
                              ? "text-amber-300"
                              : "text-zinc-500",
                        )}
                      >
                        {(m.errorRate * 100).toFixed(0)}%
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-zinc-400">
                        {dollars(m.totalCostCents)}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        {(() => {
                          const trend = data.latencyTrend?.find((t) => t.model === m.model);
                          const seq = trend?.buckets.map((b) => b.p95Ms) ?? [];
                          if (seq.length < 2) return <span className="text-[8px] text-zinc-600">—</span>;
                          // Tone: latency trend up = bad (slower)
                          const last = seq[seq.length - 1];
                          const first = seq[0];
                          const color = last > first ? "#f87171" : last < first ? "#34d399" : "#7dd3fc";
                          return (
                            <Sparkline
                              data={seq}
                              width={64}
                              height={16}
                              color={color}
                              showDot
                              animate={false}
                            />
                          );
                        })()}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        {supports ? (
                          <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" title="tools supported" />
                        ) : (
                          <span className="inline-block h-2 w-2 rounded-full bg-amber-400" title="tools stripped — model lacks function calling" />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* Slow + error sidebars */}
      {data && (data.slowestModels.length > 0 || data.errorProneModels.length > 0) && (
        <div className="grid gap-3 md:grid-cols-2">
          {data.slowestModels.length > 0 && (
            <Panel>
              <h2 className="mb-2 text-sm font-semibold text-white">slowest models · p95</h2>
              <div className="space-y-1">
                {data.slowestModels.map((m) => (
                  <div
                    key={`s-${m.model}`}
                    className="flex items-center justify-between rounded px-2 py-1.5 hover:bg-white/[0.03]"
                  >
                    <span className="truncate font-mono text-xs text-zinc-200">{m.model}</span>
                    <span className={cn("font-mono text-xs tabular-nums", latencyTone(m.p95Ms))}>
                      {ms(m.p95Ms)}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          )}
          {data.errorProneModels.length > 0 && (
            <Panel>
              <h2 className="mb-2 text-sm font-semibold text-white">error-prone models</h2>
              <div className="space-y-1">
                {data.errorProneModels.map((m) => (
                  <div
                    key={`e-${m.model}`}
                    className="flex items-center justify-between rounded px-2 py-1.5 hover:bg-white/[0.03]"
                  >
                    <span className="truncate font-mono text-xs text-zinc-200">{m.model}</span>
                    <span className="font-mono text-xs tabular-nums text-rose-300">
                      {(m.errorRate * 100).toFixed(0)}%
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>
      )}

      {/* Rate-limit buckets */}
      {data && data.health.rateLimit.buckets.length > 0 && (
        <Panel>
          <h2 className="mb-2 text-sm font-semibold text-white">app rate-limit buckets</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {data.health.rateLimit.buckets.map((b) => (
              <div
                key={b.name}
                className="rounded-lg border border-white/10 bg-white/[0.02] p-2"
              >
                <div className="text-[10px] uppercase tracking-wider text-zinc-500">
                  {b.name}
                </div>
                <div className="mt-0.5 font-mono text-sm tabular-nums">
                  {b.max}
                  <span className="text-[10px] text-zinc-500"> / {Math.round(b.windowMs / 1000)}s</span>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <p className="pt-2 text-center text-[10px] text-zinc-600">
        auto-refresh 30s · build {data?.buildMs ?? 0}ms · sources: ai_generations + provider-health
      </p>
    </StandardPage>
  );
}

function StatTile({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-zinc-500">
        {icon}
        {label}
      </div>
      <div className={cn("mt-1 font-mono text-2xl font-bold tabular-nums", tone)}>
        {value}
      </div>
      <div className="mt-0.5 text-[10px] text-zinc-500 tabular-nums">{sub}</div>
    </div>
  );
}

function CalibTile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string | number;
  sub: string;
  tone: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-2">
      <div className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={cn("mt-0.5 font-mono text-base font-bold tabular-nums", tone)}>{value}</div>
      <div className="text-[9px] text-zinc-500">{sub}</div>
    </div>
  );
}
