/**
 * /api/system/rate-limits — lightweight provider/quota status for the
 * chat HUD pill.
 *
 * v6 · BATCH 2 · Apr 28 — This is the cheap-poll endpoint (10s cache).
 * The chat header pings this every ~30s to show a green/amber/red dot
 * and a one-line label like "all green" / "Venice cooldown 45s" /
 * "AI offline".
 *
 * Auth: session cookie. Unauth returns 401 (no anonymous polling).
 *
 * v10.0.529.106 · Wave 79 · migrated to apiHandler. Returns raw
 * NextResponse so the Cache-Control header survives + the consumer
 * (use-provider-health.ts) keeps reading top-level keys (tone,
 * label, providers). Wrapper still provides rate-limit gate, auth,
 * audit trace IDs.
 */

import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/utils/http";
import { getProviderHealth } from "@/lib/ai/provider-health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = apiHandler(
  async () => {
    const health = await getProviderHealth();

    // Compress to the minimum the pill needs — keeps the polling traffic
    // small. Full detail is available at /api/system/costs.
    const compact = {
      tone: health.overallTone,
      label: health.pillLabel,
      providers: health.providers.map((p) => ({
        name: p.name,
        available: p.available,
        cooldownMs: p.quotaCooldownRemainingMs,
        tools: p.toolsSupported,
        errorRate: Math.round(p.errorRate * 100),
        recentCalls: p.recentCalls,
      })),
      generatedAt: health.generatedAt,
    };

    return NextResponse.json(compact, {
      headers: {
        "Cache-Control": "private, max-age=10",
      },
    });
  },
  { auth: "owner" },
);
