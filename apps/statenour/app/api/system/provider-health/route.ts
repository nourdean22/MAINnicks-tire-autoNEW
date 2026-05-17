/**
 * /api/system/provider-health · v10.0.347 · standalone provider-health
 * snapshot endpoint.
 *
 * Wraps lib/ai/provider-health.ts getProviderHealth() in a typed JSON
 * response so the chat <ProviderDegradationBanner> + future surfaces
 * can poll a single canonical source. Pre-v10.0.347 the banner was
 * incorrectly polling /api/ai/venice-status which returns a Venice-
 * only payload (balance, rateLimits) · NOT the multi-provider snapshot.
 *
 * Returns the full ProviderHealthSnapshot:
 *   · generatedAt · ISO timestamp
 *   · providers   · per-provider availability + cooldown + recent errors
 *   · rateLimit   · current rate-limit state
 *   · overallTone · "green" | "amber" | "red"
 *   · pillLabel   · short human label
 *
 * Cached server-side for 30s · matches HUD polling cadence.
 *
 * v10.0.529.106 · Wave 79 · migrated to apiHandler. Returns raw
 * NextResponse so the Cache-Control header survives + the consumer
 * (provider-degradation-banner.tsx) keeps reading top-level keys.
 */

import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/utils/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = apiHandler(
  async () => {
    try {
      const { getProviderHealth } = await import("@/lib/ai/provider-health");
      const snapshot = await getProviderHealth();
      return NextResponse.json(snapshot, {
        headers: { "Cache-Control": "private, max-age=30" },
      });
    } catch (err) {
      return NextResponse.json(
        {
          error: "provider-health probe failed",
          detail: err instanceof Error ? err.message.slice(0, 200) : "unknown",
        },
        { status: 503 },
      );
    }
  },
  { auth: "owner" },
);
