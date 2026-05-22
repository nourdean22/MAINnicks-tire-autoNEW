/**
 * GET /api/system/performance — per-route latency percentiles.
 *
 * Reads api_request_logs (already written by apiHandler) and returns
 * p50/p95/p99 + error rate per path. Uses Postgres percentile_cont for
 * correctness — JavaScript percentile on 10K rows would be expensive.
 *
 * Slow threshold: routes with p95 > 2000ms flag as "slow".
 *
 * Phase B.7b (2026-05-22 · legacy-modernizer REST→tRPC system-pages
 * slice) · the percentile query moved to the shared
 * `lib/services/system-pages-b.buildRoutePerformance` service · this
 * route AND the new `trpc.system.routePerformance` procedure call the
 * same function · drift impossible. The route stays mounted as the
 * rollback path.
 */

import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { sanitizeError } from "@/lib/utils/sanitize-error";
import { buildRoutePerformance } from "@/lib/services/system-pages-b";

export async function GET(req: Request) {
  await requireSession(req);
  const url = new URL(req.url);
  const hours = Number(url.searchParams.get("hours") ?? "24");
  const minRequests = Number(url.searchParams.get("minRequests") ?? "5");

  try {
    const data = await buildRoutePerformance({ hours, minRequests });
    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json(
      { data: null, error: sanitizeError(err) },
      { status: 500 },
    );
  }
}
