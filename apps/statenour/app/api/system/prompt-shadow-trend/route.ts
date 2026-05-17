/**
 * GET /api/system/prompt-shadow-trend · v9.1.6 · Apr 30.
 *
 * Reads the SystemMetric rows written by the shadow-mode pipeline and
 * exposes them as three time-series for the operator dashboard. Uses
 * the same `lib/ai/prompt/v2/shadow-metrics.readShadowTrend()` helper
 * that powers every consumer, so the numbers always agree.
 *
 * Query params:
 *   ?days=7  (default; clamped 1..30)
 *
 * Response shape:
 *   { generatedAt, windowDays, summary, series }
 *   where series carries 3 arrays of {createdAt, value, tags} rows.
 *
 * Drives the v9.1.6 trend strip on /system/prompt-comparison.
 */

import { apiHandler } from "@/lib/utils/http";
import { readShadowTrend } from "@/lib/ai/prompt/v2/shadow-metrics";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// v9.1.12 · `auth: "owner"` was missing in the v9.1.6 ship — this
// endpoint surfaces tier/slot metadata + v1/v2 char counts which is
// internal operator telemetry, not public data. Lock it down before
// flipping NICK_PRIME_PROMPT=on broadens its usefulness.
export const GET = apiHandler(
  async (req) => {
    const u = new URL(req.url);
    const daysParam = parseInt(u.searchParams.get("days") ?? "7", 10);
    const windowDays = clamp(Number.isFinite(daysParam) ? daysParam : 7, 1, 30);

    const series = await readShadowTrend(windowDays);

    // Compact summary for sparkline header — last 24h average + sample count.
    const last24Cutoff = Date.now() - 86_400_000;
    const last24 = series.charsDeltaPct.filter(
      (p) => new Date(p.createdAt).getTime() >= last24Cutoff,
    );
    const avgPct24h =
      last24.length === 0
        ? null
        : Math.round(
            (last24.reduce((acc, p) => acc + p.value, 0) / last24.length) * 10,
          ) / 10;

    return {
      generatedAt: new Date().toISOString(),
      windowDays,
      summary: {
        sampleCount: series.charsDeltaPct.length,
        sampleCount24h: last24.length,
        avgPct24h,
        latestPct:
          series.charsDeltaPct[series.charsDeltaPct.length - 1]?.value ?? null,
        latestAt:
          series.charsDeltaPct[series.charsDeltaPct.length - 1]?.createdAt ??
          null,
      },
      series,
    };
  },
  { auth: "owner" },
);
