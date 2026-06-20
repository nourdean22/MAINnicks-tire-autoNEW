/**
 * System-data service · Phase UU.2 (2026-05-22 · legacy-modernizer
 * REST→tRPC settings slice).
 *
 * Lifted verbatim from three sibling route handlers so the legacy REST
 * endpoints AND the new `system.*` tRPC procedures call the same
 * functions · drift between consumers structurally impossible:
 *
 *   buildHealthTrend     ← app/api/system/health-trend/route.ts
 *   buildErrorRateByRoute ← app/api/system/error-rate-by-route/route.ts
 *   buildIntegrationQuotas ← app/api/system/integration-quotas/route.ts
 *
 * All three back the SystemDataCards panel on /settings. They were
 * inline in their route handlers (no shared module) until this slice;
 * the logic is moved here byte-for-byte so the routes can delegate.
 */

import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

// ──────────────────────────── Health trend ────────────────────────────

interface DigestPoint {
  date: string;
  overall: "healthy" | "warning" | "critical";
  critical: number;
  warning: number;
  healthy: number;
  cronsSilent: number;
  staleRows: number;
  envReady: number;
  envTotal: number;
}

const ALLOWED_RANGES: Record<string, number> = {
  "7d": 7,
  "14d": 14,
  "30d": 30,
};

/** 7/14/30-day SystemHealthDigest trend series for the sparkline card. */
export async function buildHealthTrend(range = "7d") {
  const days = ALLOWED_RANGES[range] ?? 7;
  const since = new Date(Date.now() - days * 86_400_000);
  const sinceKey = since.toISOString().slice(0, 10);

  const rows = await prisma.brainMemory.findMany({
    where: {
      category: BRAIN_CATEGORIES.SYSTEM_HEALTH_DIGEST,
      key: { gte: sinceKey },
      deletedAt: null,
    },
    orderBy: { key: "asc" },
    select: { key: true, content: true },
  });

  const series: DigestPoint[] = [];
  for (const r of rows) {
    try {
      const d = JSON.parse(r.content) as {
        overall: DigestPoint["overall"];
        counts?: { critical?: number; warning?: number; healthy?: number };
        stats?: {
          cronsSilent?: number;
          staleRows?: number;
          envReady?: number;
          envTotal?: number;
        };
      };
      series.push({
        date: r.key,
        overall: d.overall ?? "healthy",
        critical: d.counts?.critical ?? 0,
        warning: d.counts?.warning ?? 0,
        healthy: d.counts?.healthy ?? 0,
        cronsSilent: d.stats?.cronsSilent ?? 0,
        staleRows: d.stats?.staleRows ?? 0,
        envReady: d.stats?.envReady ?? 0,
        envTotal: d.stats?.envTotal ?? 0,
      });
    } catch {
      // skip malformed
    }
  }

  const latest = series[series.length - 1];
  let avgWarnings = 0;
  let peakWarnings = 0;
  if (series.length > 0) {
    avgWarnings =
      Math.round(
        (series.reduce((s, p) => s + p.warning, 0) / series.length) * 100,
      ) / 100;
    peakWarnings = Math.max(...series.map((p) => p.warning));
  }

  // Recovery-time: count consecutive trailing days of healthy
  let recoveryDays = 0;
  if (latest?.overall === "healthy") {
    for (let i = series.length - 1; i >= 0; i--) {
      if (series[i].overall === "healthy") recoveryDays++;
      else break;
    }
  }

  // Direction: compare second-half avg warning to first-half
  let direction: "improving" | "degrading" | "stable" = "stable";
  if (series.length >= 4) {
    const mid = Math.floor(series.length / 2);
    const firstAvg =
      series.slice(0, mid).reduce((s, p) => s + p.warning, 0) /
      Math.max(1, mid);
    const secondAvg =
      series.slice(mid).reduce((s, p) => s + p.warning, 0) /
      Math.max(1, series.length - mid);
    const delta = secondAvg - firstAvg;
    if (delta < -0.5) direction = "improving";
    else if (delta > 0.5) direction = "degrading";
  }

  return {
    generatedAt: new Date().toISOString(),
    range,
    days,
    series,
    summary: {
      avgWarnings,
      peakWarnings,
      recoveryDays,
      direction,
      latestOverall: latest?.overall ?? "unknown",
      seriesLength: series.length,
    },
  };
}

// ──────────────────────── Error rate by route ────────────────────────

const RANGE_TO_HOURS: Record<string, number> = {
  "1h": 1,
  "24h": 24,
  "7d": 24 * 7,
};

interface RouteRow {
  path: string;
  method: string;
  requests: number;
  errors: number;
  p50_ms: number;
  p95_ms: number;
  max_ms: number;
}

/** Per-route reliability metrics over a window, scored "fix-first". */
export async function buildErrorRateByRoute(range = "24h", minRequests = 5) {
  const minReq = Math.max(1, minRequests || 5);
  const hours = RANGE_TO_HOURS[range] ?? 24;
  const since = new Date(Date.now() - hours * 3_600_000);

  const [routeRows, errorRows] = await Promise.all([
    prisma.$queryRawUnsafe<RouteRow[]>(
      `
        SELECT
          path::text,
          method::text,
          COUNT(*)::int AS requests,
          0::int AS errors,
          percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms)::int AS p50_ms,
          percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::int AS p95_ms,
          MAX(duration_ms)::int AS max_ms
        FROM api_request_logs
        WHERE created_at >= $1
        GROUP BY path, method
        HAVING COUNT(*) >= $2
        ORDER BY requests DESC
        LIMIT 200
      `,
      since.toISOString(),
      minReq,
    ),
    prisma.$queryRawUnsafe<Array<{ path: string; errors: number }>>(
      `
        SELECT
          (context->>'path')::text AS path,
          COUNT(*)::int AS errors
        FROM error_logs
        WHERE created_at >= $1
          AND context->>'path' IS NOT NULL
        GROUP BY context->>'path'
      `,
      since.toISOString(),
    ),
  ]);

  const errorByPath = new Map<string, number>();
  for (const r of errorRows) {
    errorByPath.set(r.path, r.errors);
  }

  const routes = routeRows
    .map((r) => {
      const errors = errorByPath.get(r.path) ?? 0;
      const errorRate = r.requests === 0 ? 0 : errors / r.requests;
      const score =
        Math.round(errorRate * 1000 * Math.log10(Math.max(2, r.requests))) /
        100;
      return {
        path: r.path,
        method: r.method,
        requests: r.requests,
        errors,
        errorRate: Math.round(errorRate * 10000) / 100, // pct
        p50Ms: r.p50_ms,
        p95Ms: r.p95_ms,
        maxMs: r.max_ms,
        score,
      };
    })
    .sort((a, b) => b.score - a.score);

  const totalRequests = routes.reduce((s, r) => s + r.requests, 0);
  const totalErrors = routes.reduce((s, r) => s + r.errors, 0);

  return {
    window: { range, hours, since: since.toISOString() },
    summary: {
      totalRoutes: routes.length,
      totalRequests,
      totalErrors,
      overallErrorRate:
        totalRequests === 0
          ? 0
          : Math.round((totalErrors / totalRequests) * 10000) / 100,
    },
    worstByScore: routes.slice(0, 20),
    worstByCount: [...routes].sort((a, b) => b.errors - a.errors).slice(0, 20),
  };
}

// ─────────────────────── Integration quotas ───────────────────────

interface QuotaProbe {
  provider: string;
  ok: boolean;
  status: "configured" | "missing" | "error" | "unknown";
  data?: Record<string, unknown>;
  error?: string;
  ms?: number;
}

/**
 * Real-time cost/quota state per provider for the dashboard card.
 *
 * Venice was statenour's only first-party metered integration and its
 * sole probe here; it has been retired, leaving no provider to probe.
 * Twilio/Resend/Stripe are nickstire's (SMS/email/payments live there)
 * and statenour is on Railway, not Vercel — probing those here only
 * ever reported a misleading permanent "missing". With no probes the
 * rollup is empty and the dashboard card hides itself rather than
 * lying with a "0/1 live" forever.
 */
export async function buildIntegrationQuotas() {
  const probes: QuotaProbe[] = [];

  return {
    generatedAt: new Date().toISOString(),
    probes,
    summary: {
      total: probes.length,
      configured: probes.filter((p) => p.status === "configured").length,
      missing: probes.filter((p) => p.status === "missing").length,
      errors: probes.filter((p) => p.status === "error").length,
    },
  };
}
