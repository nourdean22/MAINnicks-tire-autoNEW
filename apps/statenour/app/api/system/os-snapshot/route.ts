/**
 * GET /api/system/os-snapshot · v10.0.526 · Arc A F5
 *
 * Returns the last 30 days of os_snapshot.* metrics + the latest
 * drift report. Powers the Ultron OS-drift tile.
 *
 * Owner-only (same shape as /api/system/metrics) — these numbers
 * expose internal code-health signals that shouldn't leak.
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { OS_SNAPSHOT_METRIC_NAMES } from "@/lib/observability/os-snapshot";
import { compareToWeekAgo } from "@/lib/observability/drift-detector";

interface SeriesPoint {
  value: number;
  createdAt: Date;
}

export const GET = apiHandler(
  async () => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60_000);

    // Fan-out per metric so each gets its own latest-30d window. The
    // composite index on (metric, createdAt) makes these cheap.
    const seriesByMetric: Record<string, SeriesPoint[]> = {};
    await Promise.all(
      OS_SNAPSHOT_METRIC_NAMES.map(async (metric) => {
        const rows = await prisma.systemMetric
          .findMany({
            where: { metric, createdAt: { gte: thirtyDaysAgo } },
            select: { value: true, createdAt: true },
            orderBy: { createdAt: "asc" },
            take: 200,
          })
          .catch((): SeriesPoint[] => []);
        seriesByMetric[metric] = rows;
      }),
    );

    const report = await compareToWeekAgo();

    return {
      series: seriesByMetric,
      drift: report,
      metricNames: OS_SNAPSHOT_METRIC_NAMES,
    };
  },
  { auth: "owner" },
);
