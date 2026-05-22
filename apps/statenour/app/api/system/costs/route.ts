/**
 * /api/system/costs — operator-grade cost+latency+health rollup.
 *
 * v6 · BATCH 2 · Apr 28. Goes deeper than /api/system/ai-cost (which
 * just shows by-feature/by-model spend). This endpoint adds:
 *   · per-model latency p50/p95/p99 + error rate
 *   · live provider health (quota breakers, tool support, recent errors)
 *   · daily budget gauge with burn-rate
 *   · today's image vs chat split
 *
 * Used by /system/costs page. Auth: session cookie.
 *
 * Phase B.7a (2026-05-22) · the rollup assembly moved to the shared
 * `system-pages.buildSystemCosts` service so the legacy REST consumer
 * AND the new `system.costs` tRPC procedure can't drift. The page reads
 * top-level keys (data.budget.limit, etc) so the route returns the
 * payload directly via NextResponse. This route stays mounted as the
 * coexistence / rollback path.
 */

import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/utils/http";
import { buildSystemCosts } from "@/lib/services/system-pages";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = apiHandler(
  async (req) => {
    const { searchParams } = new URL(req.url);
    const days = Number(searchParams.get("days") ?? "7");
    const payload = await buildSystemCosts({ days });
    return NextResponse.json(payload);
  },
  { auth: "owner" },
);
