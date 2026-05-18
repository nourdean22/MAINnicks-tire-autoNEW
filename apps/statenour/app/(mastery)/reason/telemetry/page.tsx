"use client";

/**
 * /reason/telemetry · Phase H.5 (2026-05-18 PM)
 *
 * Reasoning-engine meta-view. Reads /api/nick/reason/telemetry and
 * surfaces:
 *
 *   · Totals · today's spend vs cap · all-time runs + spend
 *   · Tier stats · per-tier · runs · p50/p95 latency · avg cost ·
 *     fallback rate · avg confidence
 *   · Marker quality (H.5.3) · per-classifier-reason bucket · avg
 *     confidence · fallback rate · verdict (good/ok/tune)
 *
 * Built so the operator can SEE which tiers earn their cost and
 * which markers misfire. Pre-H.5 the persisted traces were write-
 * only · this closes the meta-view loop.
 *
 * Aesthetic · editorial-minimalist · matches /reason/history.
 */

import Link from "next/link";
// Phase J · tRPC · telemetry reads via trpc.nick.telemetry · types
// inferred · marker quality + tier stats all flow from one source.
import { trpc } from "@/lib/trpc/client";
import { MasteryErrorView } from "@/components/mastery/mastery-error-view";
import { MasterySkeleton } from "@/components/mastery/mastery-skeleton";

interface TierStat {
  tier: string;
  runs: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  avgCostUsd: number;
  totalCostUsd: number;
  avgConfidence: number;
  fallbackRate: number;
}

interface MarkerQualityRow {
  marker: string;
  count: number;
  avgConfidence: number;
  fallbackRate: number;
  verdict: "good" | "ok" | "tune";
}

interface TelemetryShape {
  totals: {
    totalRuns: number;
    totalSpendAllUsd: number;
    spentTodayUsd: number;
    dailyCapUsd: number;
    oldestRun: string | null;
    newestRun: string | null;
  };
  tierStats: TierStat[];
  markerCounts: Record<string, number>;
  markerQuality: MarkerQualityRow[];
  fetchedAt: string;
}

const TIER_TONE: Record<string, string> = {
  quick: "text-[var(--text-tertiary)]",
  standard: "text-sky-300",
  deep: "text-violet-300",
  thorough: "text-amber-300",
  mega: "text-[var(--gold)]",
};

const VERDICT_TONE: Record<MarkerQualityRow["verdict"], string> = {
  good: "text-emerald-300",
  ok: "text-amber-300",
  tune: "text-red-300",
};

function fmtMs(ms: number): string {
  if (ms >= 10_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms >= 1_000) return `${(ms / 1000).toFixed(2)}s`;
  return `${ms}ms`;
}

export default function TelemetryPage() {
  const { data, error, isLoading, refetch } = trpc.nick.telemetry.useQuery(
    undefined,
    { staleTime: 30_000 },
  );

  if (isLoading && !data) return <MasterySkeleton cards={3} maxWidth="max-w-3xl" />;
  if (error)
    return (
      <MasteryErrorView
        label="Reasoning telemetry"
        error={error.message}
        onRetry={() => void refetch()}
      />
    );
  if (!data) return null;

  const { totals, tierStats, markerQuality } = data;
  const budgetPct = Math.min(100, (totals.spentTodayUsd / totals.dailyCapUsd) * 100);
  const budgetTone =
    budgetPct >= 90 ? "bg-red-400" : budgetPct >= 60 ? "bg-amber-400" : "bg-emerald-400";

  return (
    <main className="min-h-[100dvh] bg-[#0A0A0A] text-white">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-10 space-y-8">
        {/* Header */}
        <header className="flex items-baseline justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-tertiary)] mb-1">
              Nick · reasoning
            </p>
            <h1 className="text-2xl font-medium text-[var(--text-primary)]">
              Telemetry
            </h1>
          </div>
          <div className="flex items-center gap-4 text-[10px] font-mono uppercase tracking-[0.14em]">
            <Link
              href="/reason/history"
              className="text-[var(--text-secondary)] hover:text-[var(--gold)] transition"
            >
              history →
            </Link>
            <Link
              href="/reason"
              className="text-[var(--text-secondary)] hover:text-[var(--gold)] transition"
            >
              ← back
            </Link>
          </div>
        </header>

        {/* Budget bar */}
        <section className="space-y-2">
          <div className="flex items-baseline justify-between gap-3 text-[10px] font-mono uppercase tracking-[0.14em]">
            <span className="text-[var(--text-tertiary)]">today · spend</span>
            <span className="tabular-nums text-[var(--text-secondary)]">
              ${totals.spentTodayUsd.toFixed(3)} / ${totals.dailyCapUsd.toFixed(2)}
              <span className="ml-2 text-[var(--text-tertiary)]">{budgetPct.toFixed(0)}%</span>
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${budgetTone}`}
              style={{ width: `${budgetPct}%` }}
            />
          </div>
          <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-[var(--text-tertiary)] tabular-nums">
            all-time · {totals.totalRuns} run{totals.totalRuns === 1 ? "" : "s"} · ${totals.totalSpendAllUsd.toFixed(3)} spent
          </p>
        </section>

        {/* Tier stats */}
        <section className="space-y-3">
          <h2 className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
            Per-tier stats
          </h2>
          {tierStats.length === 0 ? (
            <p className="text-sm text-[var(--text-tertiary)]">No runs yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="text-[10px] uppercase tracking-[0.14em] text-[var(--text-tertiary)] border-b border-white/10">
                    <th className="text-left py-2 pr-3">tier</th>
                    <th className="text-right py-2 px-2 tabular-nums">runs</th>
                    <th className="text-right py-2 px-2 tabular-nums">p50</th>
                    <th className="text-right py-2 px-2 tabular-nums">p95</th>
                    <th className="text-right py-2 px-2 tabular-nums">avg $</th>
                    <th className="text-right py-2 px-2 tabular-nums">total $</th>
                    <th className="text-right py-2 px-2 tabular-nums">conf</th>
                    <th className="text-right py-2 pl-2 tabular-nums">fb %</th>
                  </tr>
                </thead>
                <tbody>
                  {tierStats.map((t) => (
                    <tr key={t.tier} className="border-b border-white/5 hover:bg-white/[0.02]">
                      <td className={`py-2 pr-3 uppercase tracking-[0.14em] ${TIER_TONE[t.tier] ?? "text-[var(--text-tertiary)]"}`}>
                        {t.tier}
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums">{t.runs}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{fmtMs(t.p50LatencyMs)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{fmtMs(t.p95LatencyMs)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">${t.avgCostUsd.toFixed(4)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">${t.totalCostUsd.toFixed(3)}</td>
                      <td className="py-2 px-2 text-right tabular-nums">{(t.avgConfidence * 100).toFixed(0)}%</td>
                      <td className={`py-2 pl-2 text-right tabular-nums ${t.fallbackRate >= 25 ? "text-red-300" : t.fallbackRate >= 10 ? "text-amber-300" : "text-emerald-300"}`}>
                        {t.fallbackRate.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Marker quality */}
        <section className="space-y-3">
          <h2 className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]">
            Classifier marker quality
          </h2>
          <p className="text-xs text-[var(--text-tertiary)]">
            Each marker is the first word of the classifier reason. Markers tagged{" "}
            <span className="text-emerald-300">good</span> are reliable, <span className="text-amber-300">ok</span> is acceptable, <span className="text-red-300">tune</span> means the marker fires but produces low-confidence answers — candidate to refine.
          </p>
          {markerQuality.length === 0 ? (
            <p className="text-sm text-[var(--text-tertiary)]">No classifier data yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {markerQuality.map((m) => (
                <li
                  key={m.marker}
                  className="flex items-center justify-between gap-3 text-xs font-mono tabular-nums border-b border-white/5 py-1.5"
                >
                  <span className="text-[var(--text-primary)] uppercase tracking-[0.14em]">
                    {m.marker}
                  </span>
                  <span className="text-[var(--text-tertiary)] text-right space-x-3">
                    <span>{m.count}×</span>
                    <span>{(m.avgConfidence * 100).toFixed(0)}% conf</span>
                    <span>{m.fallbackRate.toFixed(1)}% fb</span>
                    <span className={`uppercase tracking-[0.14em] ${VERDICT_TONE[m.verdict]}`}>
                      {m.verdict}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-[var(--text-tertiary)] tabular-nums">
          composed · {new Date(data.fetchedAt).toLocaleTimeString("en-US", {
            hour: "numeric",
            minute: "2-digit",
            second: "2-digit",
          })}
        </p>
      </div>
    </main>
  );
}
