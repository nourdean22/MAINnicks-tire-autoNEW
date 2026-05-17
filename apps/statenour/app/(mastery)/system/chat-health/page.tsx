"use client";

/**
 * /system/chat-health — operator-level chat-route health dashboard.
 *
 * Single-page view: latency, cost, volume, error rate, quality,
 * problem tools, provider mix. Reads /api/system/chat-health.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { StandardPage } from "@/components/layout/standard-page";
import { Panel } from "@/components/panel";
import { FreshnessChip } from "@/components/ui/freshness-chip";
import { authedFetch } from "@/hooks/use-authed-fetch";
import { cn } from "@/lib/utils/cn";
import {
  AlertTriangle,
  Activity,
  DollarSign,
  Gauge,
  AlertCircle,
  Wrench,
  Cpu,
} from "lucide-react";

interface Payload {
  window: { hours: number; since: string };
  latency: { p50: number; p95: number; p99: number; avg: number; requests24h: number };
  cost: { totalCents24h: number; totalCents7d: number; avgPerTurnCents: number };
  volume: { total: number; errors: number; errorRate: number };
  quality: { assistantTurns: number; regenSuggested: number; regenRate: number; avgQuality: number };
  topErrors: Array<{ message: string; count: number; lastSeen: string | null }>;
  toolHealth: Array<{
    tool: string;
    calls: number;
    successRate: number;
    avgMs: number;
    failCount: number;
    lastCallAt: number | null;
    recentErrors: Array<{ message: string; at: number }>;
  }>;
  problemTools: Array<{ tool: string; calls: number; successRate: number; failCount: number }>;
  providerMix: Array<{ model: string; count: number }>;
  promptCache?: {
    size: number;
    hits: number;
    misses: number;
    sets: number;
    hitRate: number;
    lastResetAt: number;
    ttlMs: number;
  };
  blockedTools?: Array<{ toolName: string; trippedAt: number; remainingMs: number }>;
  generatedAt: string;
}

function latencyClass(ms: number): string {
  if (ms > 4000) return "text-rose-300";
  if (ms > 2500) return "text-amber-300";
  if (ms > 1500) return "text-sky-300";
  return "text-emerald-300";
}

function rateClass(rate: number): string {
  if (rate > 0.1) return "text-rose-300";
  if (rate > 0.03) return "text-amber-300";
  return "text-[var(--text-secondary)]";
}

export default function ChatHealthPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authedFetch("/api/system/chat-health", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json.data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <StandardPage
      eyebrow="NOUR OS · System"
      title="Chat health"
      description={
        data
          ? `${data.volume.total} requests · ${data.quality.assistantTurns} replies · ${data.problemTools.length} problem tools · last 24h`
          : ""
      }
      width="2xl"
      rhythm="comfortable"
      actions={
        <FreshnessChip
          lastFetchedAt={data?.generatedAt ?? null}
          source="api_request_logs · ai_generations · tool_telemetry"
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

      {/* ROLLUP TILES */}
      {data && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile
            label="TTFT p50"
            value={`${data.latency.p50}ms`}
            tone={data.latency.p50 > 2500 ? "warn" : "ok"}
            icon={Gauge}
          />
          <Tile
            label="TTFT p95"
            value={`${data.latency.p95}ms`}
            tone={data.latency.p95 > 4000 ? "critical" : data.latency.p95 > 2500 ? "warn" : "ok"}
            icon={Gauge}
          />
          <Tile
            label="Cost / turn"
            value={`${(data.cost.avgPerTurnCents / 100).toFixed(3)}¢`}
            tone="info"
            icon={DollarSign}
          />
          <Tile
            label="Error rate"
            value={`${(data.volume.errorRate * 100).toFixed(1)}%`}
            tone={data.volume.errorRate > 0.1 ? "critical" : data.volume.errorRate > 0.03 ? "warn" : "ok"}
            icon={AlertTriangle}
          />
          <Tile
            label="Regen rate"
            value={`${(data.quality.regenRate * 100).toFixed(0)}%`}
            tone={data.quality.regenRate > 0.2 ? "warn" : "ok"}
            icon={Activity}
            hint="Reply-gate flags"
          />
          <Tile
            label="Avg quality"
            value={`${Math.round(data.quality.avgQuality * 100)}/100`}
            tone={data.quality.avgQuality < 0.6 ? "warn" : "ok"}
            icon={Activity}
          />
          <Tile
            label="Cost 24h"
            value={`$${(data.cost.totalCents24h / 100).toFixed(2)}`}
            tone="info"
            icon={DollarSign}
          />
          <Tile
            label="Cost 7d"
            value={`$${(data.cost.totalCents7d / 100).toFixed(2)}`}
            tone="info"
            icon={DollarSign}
          />
          {data.promptCache && (data.promptCache.hits + data.promptCache.misses) > 0 && (
            <Tile
              label="Prompt cache"
              value={`${Math.round(data.promptCache.hitRate * 100)}%`}
              tone={data.promptCache.hitRate < 0.4 ? "warn" : "ok"}
              icon={Activity}
              hint={`${data.promptCache.hits}/${data.promptCache.hits + data.promptCache.misses} hits · ${data.promptCache.size} entries`}
            />
          )}
        </div>
      )}

      {/* BLOCKED TOOLS — circuit breaker */}
      {data && data.blockedTools && data.blockedTools.length > 0 && (
        <Panel className="border-amber-500/30 bg-amber-500/[0.04]">
          <div className="border-b border-white/5 px-3 py-2 text-xs uppercase tracking-wide text-amber-300">
            <Wrench className="inline h-3 w-3 mr-1.5 mb-0.5" />
            Tools blocked by circuit breaker
          </div>
          <ul className="divide-y divide-white/5 text-xs">
            {data.blockedTools.map((t) => {
              const minLeft = Math.ceil(t.remainingMs / 60_000);
              return (
                <li key={t.toolName} className="flex items-center justify-between px-3 py-1.5">
                  <span className="font-mono text-[var(--text-secondary)]">{t.toolName}</span>
                  <span className="tabular-nums text-amber-300">~{minLeft}m left</span>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      {/* PROBLEM TOOLS */}
      {data && data.problemTools.length > 0 && (
        <Panel className="border-rose-500/30 bg-rose-500/[0.04]">
          <div className="border-b border-white/5 px-3 py-2 text-xs uppercase tracking-wide text-rose-300">
            <Wrench className="inline h-3 w-3 mr-1.5 mb-0.5" />
            Problem tools (≥5 calls + &lt;70% success)
          </div>
          <table className="w-full text-xs">
            <thead className="text-[var(--text-muted)]">
              <tr>
                <th className="px-3 py-2 text-left font-medium">tool</th>
                <th className="px-2 py-2 text-right font-medium">calls</th>
                <th className="px-2 py-2 text-right font-medium">ok%</th>
                <th className="px-2 py-2 text-right font-medium">fails</th>
              </tr>
            </thead>
            <tbody>
              {data.problemTools.map((t) => (
                <tr key={t.tool} className="border-t border-white/5">
                  <td className="px-3 py-1.5 font-mono">{t.tool}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{t.calls}</td>
                  <td className={cn("px-2 py-1.5 text-right tabular-nums", rateClass(1 - t.successRate))}>
                    {Math.round(t.successRate * 100)}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-rose-300">
                    {t.failCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {/* TOP ERRORS */}
      {data && data.topErrors.length > 0 && (
        <Panel>
          <div className="border-b border-white/5 px-3 py-2 text-xs uppercase tracking-wide text-[var(--text-muted)]">
            <AlertCircle className="inline h-3 w-3 mr-1.5 mb-0.5" />
            Top error fingerprints (last 24h)
          </div>
          <ul className="divide-y divide-white/5">
            {data.topErrors.map((e, i) => (
              <li key={i} className="flex items-start gap-2 px-3 py-2 text-xs">
                <span className="rounded-full border border-rose-500/35 bg-rose-500/10 px-1.5 text-[10px] text-rose-300 tabular-nums shrink-0 mt-0.5">
                  ×{e.count}
                </span>
                <Link
                  href={`/system/errors?message=${encodeURIComponent(e.message.slice(0, 60))}`}
                  className="flex-1 min-w-0 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  <span className="truncate block" title={e.message}>
                    {e.message}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* TOOL HEALTH (full) */}
      {data && data.toolHealth.length > 0 && (
        <Panel>
          <div className="border-b border-white/5 px-3 py-2 text-xs uppercase tracking-wide text-[var(--text-muted)]">
            <Wrench className="inline h-3 w-3 mr-1.5 mb-0.5" />
            All tool calls (sorted by volume)
          </div>
          <table className="w-full text-xs">
            <thead className="text-[var(--text-muted)]">
              <tr>
                <th className="px-3 py-2 text-left font-medium">tool</th>
                <th className="px-2 py-2 text-right font-medium">calls</th>
                <th className="px-2 py-2 text-right font-medium">ok%</th>
                <th className="px-2 py-2 text-right font-medium">avg ms</th>
                <th className="px-2 py-2 text-right font-medium">fails</th>
              </tr>
            </thead>
            <tbody>
              {data.toolHealth.map((t) => (
                <tr key={t.tool} className="border-t border-white/5 text-[var(--text-secondary)]">
                  <td className="px-3 py-1.5 font-mono">{t.tool}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{t.calls}</td>
                  <td
                    className={cn(
                      "px-2 py-1.5 text-right tabular-nums",
                      t.successRate >= 0.9
                        ? "text-emerald-300"
                        : t.successRate >= 0.7
                          ? "text-amber-300"
                          : "text-rose-300",
                    )}
                  >
                    {Math.round(t.successRate * 100)}
                  </td>
                  <td className={cn("px-2 py-1.5 text-right tabular-nums", latencyClass(t.avgMs))}>
                    {t.avgMs}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {t.failCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {/* PROVIDER MIX */}
      {data && data.providerMix.length > 0 && (
        <Panel>
          <div className="border-b border-white/5 px-3 py-2 text-xs uppercase tracking-wide text-[var(--text-muted)]">
            <Cpu className="inline h-3 w-3 mr-1.5 mb-0.5" />
            Provider / model distribution (last 24h)
          </div>
          <div className="flex flex-wrap gap-2 px-3 py-2 text-xs">
            {data.providerMix.map((p) => (
              <span
                key={p.model}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 font-mono text-[var(--text-secondary)]"
              >
                <span>{p.model}</span>
                <span className="tabular-nums opacity-60">{p.count}</span>
              </span>
            ))}
          </div>
        </Panel>
      )}

      {loading && !data && (
        <Panel>
          <div className="p-6 text-center text-sm text-[var(--text-muted)]">
            Loading chat-health data…
          </div>
        </Panel>
      )}
    </StandardPage>
  );
}

function Tile({
  label,
  value,
  tone,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  tone: "ok" | "warn" | "critical" | "neutral" | "info";
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  const border =
    tone === "critical"
      ? "border-rose-500/40"
      : tone === "warn"
        ? "border-amber-500/30"
        : tone === "ok"
          ? "border-emerald-500/30"
          : tone === "info"
            ? "border-sky-500/25"
            : "border-white/10";
  const bg =
    tone === "critical"
      ? "bg-rose-500/[0.08]"
      : tone === "warn"
        ? "bg-amber-500/[0.06]"
        : tone === "ok"
          ? "bg-emerald-500/[0.05]"
          : tone === "info"
            ? "bg-sky-500/[0.04]"
            : "bg-white/[0.02]";
  return (
    <div className={cn("rounded-lg border p-3", border, bg)}>
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-[var(--text-muted)]">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="mt-1 text-xl font-bold tabular-nums text-[var(--text-primary)]">
        {value}
      </div>
      {hint && (
        <div className="mt-0.5 text-[10px] text-[var(--text-muted)]">{hint}</div>
      )}
    </div>
  );
}
