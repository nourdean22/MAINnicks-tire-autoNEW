/**
 * GET /api/system/performance — per-route latency percentiles.
 *
 * Reads api_request_logs (already written by apiHandler) and returns
 * p50/p95/p99 + error rate per path over the last 24h. Uses Postgres
 * percentile_cont for correctness — JavaScript percentile on 10K rows
 * would be expensive.
 *
 * Slow threshold: routes with p95 > 2000ms flag as "slow". Fed into
 * the health digest so slow endpoints surface on HQ ambiently.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-guard";
import { sanitizeError } from "@/lib/utils/sanitize-error";

interface PerfRow {
  path: string;
  method: string;
  requests: number;
  errors: number;
  errorRate: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  avgMs: number;
  maxMs: number;
  slow: boolean;
}

const SLOW_P95_MS = 2000;

export async function GET(req: Request) {
  await requireSession(req);
  const url = new URL(req.url);
  const hours = Math.min(
    720,
    Math.max(1, Number(url.searchParams.get("hours") ?? "24")),
  );
  const since = new Date(Date.now() - hours * 3_600_000);
  const minRequests = Math.max(
    1,
    Number(url.searchParams.get("minRequests") ?? "5"),
  );

  try {
    const rows = await prisma.$queryRaw<
      Array<{
        path: string;
        method: string;
        requests: bigint;
        errors: bigint;
        p50_ms: number | null;
        p95_ms: number | null;
        p99_ms: number | null;
        avg_ms: number | null;
        max_ms: number | null;
      }>
    >`
      SELECT
        path,
        method,
        COUNT(*)::bigint AS requests,
        COUNT(*) FILTER (WHERE status_code >= 500)::bigint AS errors,
        percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms)::float8 AS p50_ms,
        percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::float8 AS p95_ms,
        percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms)::float8 AS p99_ms,
        AVG(duration_ms)::float8 AS avg_ms,
        MAX(duration_ms)::float8 AS max_ms
      FROM api_request_logs
      WHERE created_at >= ${since}
      GROUP BY path, method
      HAVING COUNT(*) >= ${minRequests}
      ORDER BY percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) DESC
      LIMIT 200
    `;

    const result: PerfRow[] = rows.map((r) => {
      const reqs = Number(r.requests);
      const errs = Number(r.errors);
      const p95 = Number(r.p95_ms ?? 0);
      return {
        path: r.path,
        method: r.method,
        requests: reqs,
        errors: errs,
        errorRate: reqs > 0 ? errs / reqs : 0,
        p50Ms: Math.round(Number(r.p50_ms ?? 0)),
        p95Ms: Math.round(p95),
        p99Ms: Math.round(Number(r.p99_ms ?? 0)),
        avgMs: Math.round(Number(r.avg_ms ?? 0)),
        maxMs: Math.round(Number(r.max_ms ?? 0)),
        slow: p95 > SLOW_P95_MS,
      };
    });

    const summary = {
      totalRoutes: result.length,
      slowRoutes: result.filter((r) => r.slow).length,
      errorRoutes: result.filter((r) => r.errorRate > 0.05).length,
      totalRequests: result.reduce((s, r) => s + r.requests, 0),
      totalErrors: result.reduce((s, r) => s + r.errors, 0),
    };

    return NextResponse.json({
      data: {
        window: { hours, since: since.toISOString() },
        slowThresholdMs: SLOW_P95_MS,
        summary,
        routes: result,
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    return NextResponse.json(
      { data: null, error: sanitizeError(err) },
      { status: 500 },
    );
  }
}
