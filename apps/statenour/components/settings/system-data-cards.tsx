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

import { useEffect, useState } from "react";
import { GlassCard } from "@/components/ui/glass-card";
import { Activity, AlertTriangle, Gauge, Sparkles } from "lucide-react";
import { authedFetch } from "@/hooks/use-authed-fetch";

// ── Health trend (7-day sparkline) ────────────────────────────
interface HealthTrendPoint {
  date: string;
  overall: "healthy" | "warning" | "critical";
  warning: number;
  critical: number;
}

interface HealthTrendData {
  series: HealthTrendPoint[];
  summary: {
    avgWarnings: number;
    peakWarnings: number;
    recoveryDays: number;
    direction: "improving" | "degrading" | "stable";
    latestOverall: string;
  };
}

function HealthTrendCard() {
  const [data, setData] = useState<HealthTrendData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authedFetch("/api/system/health-trend?range=7d")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        setData(j?.data ?? null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading || !data || data.series.length === 0) return null;

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
  const [worst, setWorst] = useState<ErrorRow[]>([]);
  const [summary, setSummary] = useState<{
    totalErrors: number;
    overallErrorRate: number;
  } | null>(null);
  // v10.0.104 audit fix · loading state matches the sibling
  // HealthTrendCard. Pre-fix, "loading" and "no errors" rendered
  // identically (both null) so any fetch failure was indistinguishable
  // from a clean run + the silent .catch() left no breadcrumb.
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authedFetch("/api/system/error-rate-by-route?range=24h")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.data) {
          setSummary(j.data.summary);
          const withErrors = (j.data.worstByScore as ErrorRow[]).filter(
            (r) => r.errors > 0,
          );
          setWorst(withErrors.slice(0, 5));
        }
        setLoading(false);
      })
      .catch((err) => {
        console.warn("[ErrorRateCard] fetch failed", err);
        setLoading(false);
      });
  }, []);

  // Silent when loading or no errors — don't clutter
  if (loading || !summary || summary.totalErrors === 0) return null;

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
  const [probes, setProbes] = useState<QuotaProbe[]>([]);
  const [summary, setSummary] = useState<{
    total: number;
    configured: number;
    missing: number;
    errors: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authedFetch("/api/system/integration-quotas")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j?.data) return;
        setProbes(j.data.probes ?? []);
        setSummary(j.data.summary ?? null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading || !summary) return null;

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
interface MotdMemory {
  id: string;
  category: string;
  key: string;
  content: string;
  confidence: number;
  ageDays: number;
}
interface MotdData {
  dayKey: string;
  pickedAt?: string;
  memory: MotdMemory | null;
  cached?: boolean;
}

function MemoryOfDayCard() {
  const [data, setData] = useState<MotdData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authedFetch("/api/brain/memory-of-the-day")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        setData(j?.data ?? null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading || !data?.memory) return null;
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
