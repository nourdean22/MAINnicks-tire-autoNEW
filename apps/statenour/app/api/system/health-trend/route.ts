/**
 * GET /api/system/health-trend · v10.0.89 · 2026-05-02.
 *
 * Reads persisted SystemHealthDigest rows out of BrainMemory and
 * returns a 7/14/30-day trend series suitable for sparkline render.
 * Each digest is keyed YYYY-MM-DD so this is a cheap range-scan.
 *
 * Output:
 *   · series: [{ date, overall, critical, warning, healthy,
 *                cronsSilent, staleRows, envReady }]
 *   · summary: {
 *       avgWarnings, peakWarnings, recoveryDays,
 *       direction: 'improving' | 'degrading' | 'stable',
 *       latestOverall
 *     }
 *
 * Recovery-time metric: if today is healthy, how many days back was
 * the last warning/critical? Useful for "we've been clean N days".
 *
 * Auth: owner only.
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

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

export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    const range = url.searchParams.get("range") ?? "7d";
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
  },
  { auth: "owner" },
);
