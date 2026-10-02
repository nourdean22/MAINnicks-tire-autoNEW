"use client";

/**
 * SystemHealthDataCards · 7-day health trend · 24h error rate by route ·
 * integration quotas.
 *
 * Born as components/settings/system-data-cards.tsx (v10.0.94, 2026-05-02),
 * mounted under Settings > Diagnostics; moved to /system/health in the
 * full-circle wave 2 recomposition (2026-10-02): these read machine health,
 * and the ownership test (docs/design/settings-census-2026-10-02.md) puts
 * machine operations on /system. The memory-of-the-day card that shipped
 * beside them is brain content and moved to /brain (components/brain/
 * memory-of-day-card.tsx). Pure rendering — the three tRPC procedures
 * (system.healthTrend · system.errorRateByRoute · system.integrationQuotas)
 * have no other consumer, so this file is what keeps them wired.
 *
 * Failure vocabulary: a failed read renders UnmeasuredLine; a measured quiet
 * (0 errors · no metered providers) renders nothing; a health trend with NO
 * digest rows in 7 days is a signal about the nightly digest cron and says so.
 */

import { GlassCard } from "@/components/ui/glass-card";
import { UnmeasuredLine } from "@/components/ui/unmeasured-line";
import { Activity, AlertTriangle, Gauge } from "lucide-react";
import { trpc } from "@/lib/trpc/client";

// ── Health trend (7-day sparkline) ────────────────────────────
// Phase UU.2 (2026-05-22) · REST→tRPC · the 7-day trend is a typed query
// (system.healthTrend); the procedure returns the report unwrapped.
function HealthTrendCard() {
  const trendQuery = trpc.system.healthTrend.useQuery({ range: "7d" });
  const data = trendQuery.data ?? null;

  if (trendQuery.isError) return <UnmeasuredLine label="Health trend" />;
  if (trendQuery.isPending || !data) return null;
  if (data.series.length === 0) {
    // Not "quiet": the nightly health-digest cron writes one row a day, so an
    // empty 7-day series means the writer has not run. /system/crons has it.
    return (
      <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-amber-300/90">
        Health trend: no digest rows in 7 days — the nightly health-digest cron has not written.
      </p>
    );
  }

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
        : "text-fg-secondary";

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
            <div className="text-[11px] font-mono space-y-0.5">
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
  // Phase UU.2 (2026-05-22) · REST→tRPC · system.errorRateByRoute. Loading
  // and a measured 0 errors both collapse the card (silent-when-empty).
  const errorQuery = trpc.system.errorRateByRoute.useQuery({ range: "24h" });
  const summary = errorQuery.data?.summary ?? null;
  const worst: ErrorRow[] = (errorQuery.data?.worstByScore ?? [])
    .filter((r) => r.errors > 0)
    .slice(0, 5);

  if (errorQuery.isError) return <UnmeasuredLine label="Error rate" />;
  if (errorQuery.isPending || !summary || summary.totalErrors === 0)
    return null;

  return (
    <GlassCard>
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle size={14} className="text-amber-400" />
        <p className="section-label">Error rate · 24h</p>
        <span className="ml-auto text-[11px] font-mono text-fg-tertiary">
          {summary.totalErrors} errors · {summary.overallErrorRate}% overall
        </span>
      </div>
      {worst.length > 0 ? (
        <div className="space-y-1">
          {worst.map((r) => (
            <div
              key={`${r.method}__${r.path}`}
              className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 text-[11px] font-mono py-1 border-b border-edge-subtle last:border-0"
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
        <p className="text-[12px] text-fg-tertiary">
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
  // Phase UU.2 (2026-05-22) · REST→tRPC · system.integrationQuotas.
  const quotasQuery = trpc.system.integrationQuotas.useQuery();
  const probes: QuotaProbe[] = quotasQuery.data?.probes ?? [];
  const summary = quotasQuery.data?.summary ?? null;

  // No metered provider probes left after Venice was retired — hide the
  // card entirely instead of rendering a misleading empty "0/0 live".
  if (quotasQuery.isError) return <UnmeasuredLine label="Integration quotas" />;
  if (quotasQuery.isPending || !summary || probes.length === 0) return null;

  return (
    <GlassCard>
      <div className="flex items-center gap-2 mb-2">
        <Gauge size={14} className="text-[var(--text-tertiary)]" />
        <p className="section-label">Integration quotas</p>
        <span className="ml-auto text-[11px] font-mono text-fg-tertiary">
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
                : "text-fg-tertiary";
          const dot =
            p.status === "configured"
              ? "bg-emerald-400"
              : p.status === "error"
                ? "bg-rose-400"
                : "bg-edge-strong";
          return (
            <div
              key={p.provider}
              className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 text-[11px] font-mono py-1 border-b border-edge-subtle last:border-0"
            >
              <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
              <span className="text-fg-secondary uppercase tracking-[0.12em]">
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

// ── Composed surface ──────────────────────────────────────────
/**
 * 2026-10-02 · Telegram is the lane every rating button and bot reply comes
 * back on. When its webhook points anywhere but this app, the bot keeps
 * SENDING (so nothing looks broken) while every tap is lost. Healthy = one
 * quiet line; anything else = an amber line that says what it costs.
 */
function TelegramWebhookLine() {
  const q = trpc.system.telegramWebhook.useQuery(undefined, { staleTime: 5 * 60_000 });
  if (q.isError) return <UnmeasuredLine label="Telegram webhook" />;
  if (q.isPending || !q.data) return null;
  const d = q.data;
  if (d.state === "registered" && !d.lastError) {
    return (
      <p className="px-1 text-[11px] font-mono text-fg-tertiary" data-telegram-webhook="registered">
        telegram webhook · {d.url} · {d.pendingUpdates ?? 0} pending
      </p>
    );
  }
  const what: Record<typeof d.state, string> = {
    registered: `registered, but Telegram's last delivery failed${d.lastErrorAt ? ` at ${new Date(d.lastErrorAt).toLocaleString()}` : ""}: ${d.lastError ?? ""}`,
    elsewhere: `points at ${d.url}, not ${d.expected}`,
    unregistered: "no webhook is registered",
    unconfigured: d.reason ?? "no bot token on this service",
    unreadable: `could not be read — ${d.reason ?? "unknown"}`,
  };
  return (
    <p
      role="status"
      data-telegram-webhook={d.state}
      className="flex items-start gap-1.5 rounded-control border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[12px] text-amber-200"
    >
      <AlertTriangle size={12} className="mt-0.5 shrink-0" />
      <span>
        Telegram webhook {what[d.state]}. Rating buttons and messages to the bot do not reach this app
        {d.pendingUpdates ? ` (${d.pendingUpdates} updates waiting at Telegram)` : ""}.
      </span>
    </p>
  );
}

export function SystemHealthDataCards() {
  return (
    <div className="space-y-3">
      <TelegramWebhookLine />
      <HealthTrendCard />
      <ErrorRateCard />
      <IntegrationQuotasCard />
    </div>
  );
}
