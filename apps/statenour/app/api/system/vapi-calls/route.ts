/**
 * GET /api/system/vapi-calls — VAPI call analytics for Nick's Tire.
 *
 * v10.0.269 · proxies VAPI's /call list endpoint with aggregations
 * so the /system/vapi-calls dashboard shows ·
 *   · total calls in the window
 *   · breakdown by status / endedReason
 *   · average duration
 *   · most-recent call
 *
 * Query params ·
 *   ?days=7   · window length (default 7, max 90)
 *
 * Auth · owner. VAPI key stays server-side · never exposed to client.
 */

import { apiHandler } from "@/lib/utils/http";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("api/system/vapi-calls");

export const dynamic = "force-dynamic";

interface VapiCall {
  id: string;
  status?: string;
  endedReason?: string | null;
  createdAt?: string;
  startedAt?: string | null;
  endedAt?: string | null;
  customer?: { number?: string };
  cost?: number;
  costBreakdown?: { total?: number };
}

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const days = Math.max(1, Math.min(90, parseInt(url.searchParams.get("days") ?? "7", 10) || 7));
  const since = new Date(Date.now() - days * 86_400_000);

  const apiKey = process.env.VAPI_API_KEY?.trim();
  if (!apiKey) {
    return {
      windowDays: days,
      sinceIso: since.toISOString(),
      totalCalls: 0,
      byStatus: {},
      byEndedReason: {},
      avgDurationSec: 0,
      mostRecent: null,
      totalCostUsd: 0,
      error: "VAPI_API_KEY not set on server",
    };
  }

  try {
    const r = await fetch(`https://api.vapi.ai/call?limit=100&createdAtGt=${encodeURIComponent(since.toISOString())}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: "no-store",
    });
    if (!r.ok) {
      log.warn("vapi_call_list_failed", { status: r.status });
      return {
        windowDays: days,
        sinceIso: since.toISOString(),
        totalCalls: 0,
        byStatus: {},
        byEndedReason: {},
        avgDurationSec: 0,
        mostRecent: null,
        totalCostUsd: 0,
        error: `VAPI returned ${r.status}`,
      };
    }
    const calls = (await r.json()) as VapiCall[];

    const byStatus: Record<string, number> = {};
    const byEndedReason: Record<string, number> = {};
    let durationSum = 0;
    let durationCount = 0;
    let costSum = 0;

    for (const c of calls) {
      const s = c.status ?? "(unknown)";
      byStatus[s] = (byStatus[s] ?? 0) + 1;
      const er = c.endedReason ?? "(none)";
      byEndedReason[er] = (byEndedReason[er] ?? 0) + 1;
      if (c.startedAt && c.endedAt) {
        const durMs = new Date(c.endedAt).getTime() - new Date(c.startedAt).getTime();
        if (durMs > 0) {
          durationSum += durMs;
          durationCount += 1;
        }
      }
      const cost = c.costBreakdown?.total ?? c.cost ?? 0;
      if (typeof cost === "number") costSum += cost;
    }

    const mostRecent = calls[0]
      ? {
          id: calls[0].id,
          createdAt: calls[0].createdAt,
          status: calls[0].status,
          endedReason: calls[0].endedReason,
          durationSec:
            calls[0].startedAt && calls[0].endedAt
              ? Math.round((new Date(calls[0].endedAt).getTime() - new Date(calls[0].startedAt).getTime()) / 1000)
              : null,
        }
      : null;

    return {
      windowDays: days,
      sinceIso: since.toISOString(),
      totalCalls: calls.length,
      byStatus,
      byEndedReason,
      avgDurationSec: durationCount > 0 ? Math.round(durationSum / durationCount / 1000) : 0,
      mostRecent,
      totalCostUsd: Number(costSum.toFixed(2)),
    };
  } catch (err) {
    log.error("vapi_call_fetch_error", { error: err instanceof Error ? err.message : String(err) });
    return {
      windowDays: days,
      sinceIso: since.toISOString(),
      totalCalls: 0,
      byStatus: {},
      byEndedReason: {},
      avgDurationSec: 0,
      mostRecent: null,
      totalCostUsd: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}, { auth: "owner" });
