/**
 * GET /api/system/error-rate-by-route · v10.0.89 · 2026-05-02.
 *
 * Joins api_request_logs against error_logs by request_id to compute
 * per-route reliability metrics over a configurable window. Surfaces
 * the routes most worth fixing first by combining traffic + error
 * rate + latency.
 *
 * Query params:
 *   · range = '1h' | '24h' | '7d' (default 24h)
 *   · minRequests = 5 (skip low-traffic noise)
 *
 * Output per route:
 *   · path + method
 *   · requests · errors · errorRate
 *   · p50Ms · p95Ms · maxMs
 *   · score (errorRate × log(requests)) — sort key for "what to fix first"
 *
 * Auth: owner only.
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";

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

export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    const range = url.searchParams.get("range") ?? "24h";
    const minRequests = Math.max(
      1,
      parseInt(url.searchParams.get("minRequests") ?? "5", 10) || 5,
    );
    const hours = RANGE_TO_HOURS[range] ?? 24;
    const since = new Date(Date.now() - hours * 3_600_000);

    // Two parallel queries: one for the route latency rollup, one
    // for the error count by path. Joining via request_id is the
    // accurate way but expensive at scale; the path-grouped error
    // count is a close-enough proxy when error_logs.context.path is
    // populated by apiHandler (it is, post-v10.0.55-21).
    const [routeRows, errorRows] = await Promise.all([
      prisma.$queryRawUnsafe<RouteRow[]>(`
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
      `, since.toISOString(), minRequests),
      prisma.$queryRawUnsafe<Array<{ path: string; errors: number }>>(`
        SELECT
          (context->>'path')::text AS path,
          COUNT(*)::int AS errors
        FROM error_logs
        WHERE created_at >= $1
          AND context->>'path' IS NOT NULL
        GROUP BY context->>'path'
      `, since.toISOString()),
    ]);

    const errorByPath = new Map<string, number>();
    for (const r of errorRows) {
      errorByPath.set(r.path, r.errors);
    }

    const routes = routeRows
      .map((r) => {
        const errors = errorByPath.get(r.path) ?? 0;
        const errorRate = r.requests === 0 ? 0 : errors / r.requests;
        // Score = errorRate × log10(requests) — heavily weights
        // routes that BOTH fail often AND get traffic. log10 keeps
        // a rare-but-important route from being drowned out.
        const score = Math.round(
          errorRate * 1000 * Math.log10(Math.max(2, r.requests)),
        ) / 100;
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
      // Top-20 by score (the ones to fix first)
      worstByScore: routes.slice(0, 20),
      // Top-20 by absolute error count
      worstByCount: [...routes]
        .sort((a, b) => b.errors - a.errors)
        .slice(0, 20),
    };
  },
  { auth: "owner" },
);
