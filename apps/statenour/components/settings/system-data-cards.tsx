"use client";

/**
 * SystemDataCards · v10.0.94 · 2026-05-02.
 *
 * UI surface for the data already produced by /api/system/health-
 * trend, /api/system/error-rate-by-route, and /api/system/integration
 * -quotas. Three GlassCards stacked, each silent-when-empty so they
 * don't clutter /settings until there's signal to surface.
 *
 * Why 3 cards: the underlying endpoints already exist + return JSON
 * the operator can't see. This is pure rendering — no new API
 * surfaces. The Karpathy lens applied: turn DORMANT-but-shipped
 * data into LIVE-and-readable.
 */

import { GlassCard } from "@/components/ui/glass-card";
import { Activity, AlertTriangle, Gauge, Sparkles } from "lucide-react";
import { trpc } from "@/lib/trpc/client";

// ── Health trend (7-day sparkline) ────────────────────────────
// Phase UU.2 (2026-05-22) · REST→tRPC · the 7-day trend is now a typed
// query (system.healthTrend). The legacy route wrapped its report in
// `{ data }`; the tRPC procedure returns it unwrapped, so `data` here
// is the report object directly. Silent-when-empty is preserved: the
// card returns null while loading and when the series is empty.
function HealthTrendCard() {
  const trendQuery = trpc.system.healthTrend.useQuery({ range: "7d" });
  const data = trendQuery.data ?? null;

  if (trendQuery.isPending || !data || data.series.length === 0) return null;

  const max = Math.max(
    1,
    ...data.series.map((p) => Math.max(p.warning, p.critical * 3)),
  );
  const w = 240;
  const h = 48;
  const stepX = w / Math.max(1, data.series.length - 1);

  const dirColor =
    data.summary.direction === "improving"
      ? "text-emerald-400"
      : data.summary.direction === "degrading"
        ? "text-rose-400"
        : "text-zinc-400";

  return (
    <GlassCard>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <Activity size={14} className="text-[var(--text-tertiary)]" />
            <p className="section-label">Health trend · 7d</p>
          </div>
          <div className="flex items-center gap-3 mt-2">
            <svg
              width={w}
              height={h}
              className="overflow-visible"
              role="img"
              aria-label="7-day warning count sparkline"
            >
              <polyline
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className={dirColor}
                points={data.series
                  .map((p, i) => `${i * stepX},${h - (p.warning / max) * h}`)
                  .join(" ")}
              />
              {data.series.map((p, i) => (
                <circle
                  key={p.date}
                  cx={i * stepX}
                  cy={h - (p.warning / max) * h}
                  r="2"
                  className={
                    p.overall === "healthy"
                      ? "fill-emerald-400"
                      : p.overall === "warning"
                        ? "fill-amber-400"
                        : "fill-rose-400"
                  }
                />
              ))}
            </svg>
            <div className="text-[10px] font-mono space-y-0.5">
              <div>
                avg warnings:{" "}
                <span className="text-[var(--text-secondary)]">
                  {data.summary.avgWarnings}
                </span>
              </div>
              <div>
                peak:{" "}
                <span className="text-[var(--text-secondary)]">
                  {data.summary.peakWarnings}
                </span>
              </div>
              <div>
                clean days:{" "}
                <span className="text-[var(--text-secondary)]">
                  {data.summary.recoveryDays}
                </span>
              </div>
              <div className={dirColor}>
                {data.summary.direction}
              </div>
            </div>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

// ── Error rate by route (top-5 worst) ─────────────────────────
interface ErrorRow {
  path: string;
  method: string;
  requests: number;
  errors: number;
  errorRate: number;
  p95Ms: number;
  score: number;
}

function ErrorRateCard() {
  // Phase UU.2 (2026-05-22) · REST→tRPC · system.errorRateByRoute. The
  // legacy route wrapped its payload in `{ data }`; the tRPC procedure
  // returns it unwrapped. Loading + no-errors both collapse the card
  // (silent-when-empty), matching the prior behaviour exactly.
  const errorQuery = trpc.system.errorRateByRoute.useQuery({ range: "24h" });
  const summary = errorQuery.data?.summary ?? null;
  const worst: ErrorRow[] = (errorQuery.data?.worstByScore ?? [])
    .filter((r) => r.errors > 0)
    .slice(0, 5);

  // Silent when loading or no errors — don't clutter
  if (errorQuery.isPending || !summary || summary.totalErrors === 0)
    return null;

  return (
    <GlassCard>
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle size={14} className="text-amber-400" />
        <p className="section-label">Error rate · 24h</p>
        <span className="ml-auto text-[10px] font-mono text-[var(--text-tertiary)]">
          {summary.totalErrors} errors · {summary.overallErrorRate}% overall
        </span>
      </div>
      {worst.length > 0 ? (
        <div className="space-y-1">
          {worst.map((r) => (
            <div
              key={`${r.method}__${r.path}`}
              className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 text-[10px] font-mono py-1 border-b border-white/5 last:border-0"
            >
              <span className="truncate text-[var(--text-secondary)]">
                {r.method} {r.path}
              </span>
              <span className="text-rose-300">
                {r.errorRate.toFixed(1)}%
              </span>
              <span className="text-[var(--text-tertiary)]">
                {r.requests}r
              </span>
              <span className="text-[var(--text-tertiary)]">
                p95 {r.p95Ms}ms
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[10px] text-[var(--text-tertiary)]">
          Errors logged but none on the top-traffic routes.
        </p>
      )}
    </GlassCard>
  );
}

// ── Integration quotas dashboard ──────────────────────────────
interface QuotaProbe {
  provider: string;
  ok: boolean;
  status: string;
  ms?: number;
  error?: string;
  data?: Record<string, unknown>;
}

function IntegrationQuotasCard() {
  // Phase UU.2 (2026-05-22) · REST→tRPC · system.integrationQuotas. The
  // legacy route wrapped its payload in `{ data }`; the tRPC procedure
  // returns it unwrapped. Silent-when-empty preserved.
  const quotasQuery = trpc.system.integrationQuotas.useQuery();
  const probes: QuotaProbe[] = quotasQuery.data?.probes ?? [];
  const summary = quotasQuery.data?.summary ?? null;

  // No metered provider probes left after Venice was retired — hide the
  // card entirely instead of rendering a misleading empty "0/0 live".
  if (quotasQuery.isPending || !summary || probes.length === 0) return null;

  return (
    <GlassCard>
      <div className="flex items-center gap-2 mb-2">
        <Gauge size={14} className="text-[var(--text-tertiary)]" />
        <p className="section-label">Integration quotas</p>
        <span className="ml-auto text-[10px] font-mono text-[var(--text-tertiary)]">
          {summary.configured}/{summary.total} live · {summary.missing} missing
          {summary.errors > 0 ? ` · ${summary.errors} err` : ""}
        </span>
      </div>
      <div className="space-y-1">
        {probes.map((p) => {
          const tint =
            p.status === "configured"
              ? "text-emerald-300"
              : p.status === "error"
                ? "text-rose-300"
                : "text-zinc-500";
          const dot =
            p.status === "configured"
              ? "bg-emerald-400"
              : p.status === "error"
                ? "bg-rose-400"
                : "bg-zinc-600";
          return (
            <div
              key={p.provider}
              className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 text-[10px] font-mono py-1 border-b border-white/5 last:border-0"
            >
              <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
              <span className="text-[var(--text-secondary)] uppercase tracking-wide">
                {p.provider}
              </span>
              <span className={tint}>{p.status}</span>
              <span className="text-[var(--text-tertiary)]">
                {p.ms ? `${p.ms}ms` : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}

// ── Memory of the day (curated daily pick) ────────────────────
// The MotdMemory / MotdData shapes are now inferred from the
// brain.memoryOfTheDay tRPC procedure return type — no hand-mirrored
// interfaces needed (Phase UU.2).
function MemoryOfDayCard() {
  // Phase UU.2 (2026-05-22) · REST→tRPC · brain.memoryOfTheDay. The
  // legacy route wrapped its payload in `{ data }`; the tRPC procedure
  // returns it unwrapped. Silent-when-empty preserved.
  const motdQuery = trpc.brain.memoryOfTheDay.useQuery();
  const data = motdQuery.data ?? null;

  if (motdQuery.isPending || !data?.memory) return null;
  const m = data.memory;
  const ageStr =
    m.ageDays === 0 ? "today" : m.ageDays === 1 ? "yesterday" : `${m.ageDays}d ago`;

  return (
    <GlassCard>
      <div className="flex items-center gap-2 mb-2">
        <Sparkles size={14} className="text-[var(--gold)]" />
        <p className="section-label">Memory of the day</p>
        <span className="ml-auto text-[10px] font-mono text-[var(--text-tertiary)]">
          {data.dayKey}
        </span>
      </div>
      <div className="text-[11px] text-[var(--text-secondary)] leading-relaxed mb-2">
        {m.content.slice(0, 360)}
        {m.content.length > 360 ? "…" : ""}
      </div>
      <div className="flex items-center gap-3 text-[10px] font-mono text-[var(--text-tertiary)]">
        <span className="uppercase tracking-wide text-[var(--gold)]/70">
          {m.category.replace(/_/g, " ")}
        </span>
        <span>·</span>
        <span>conf {m.confidence.toFixed(2)}</span>
        <span>·</span>
        <span>{ageStr}</span>
      </div>
    </GlassCard>
  );
}

// ── Composed surface ──────────────────────────────────────────
export function SystemDataCards() {
  return (
    <div className="space-y-3">
      <MemoryOfDayCard />
      <HealthTrendCard />
      <ErrorRateCard />
      <IntegrationQuotasCard />
    </div>
  );
}
