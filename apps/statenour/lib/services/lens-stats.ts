/**
 * lib/services/lens-stats.ts · Phase U.3 (2026-05-18 PM)
 *
 * Strategic-frameworks lens-firing aggregates. Extracted from
 * `app/api/system/lens-stats/route.ts` so the REST handler AND the
 * new tRPC procedure (`trpc.system.lensStats`) both call the same
 * function · drift between consumers is structurally impossible
 * (same pattern as S.2's buildHealthReport).
 *
 * Reads SystemMetric rows where metric = "ai.lens_fired" (written
 * by lib/ai/strategic-frameworks/record-lens-fire.ts).
 */

import { prisma } from "@/lib/prisma";

export interface FrameworkAgg {
  framework: string;
  count: number;
  avgScore: number;
}

export interface SurfaceAgg {
  surface: string;
  count: number;
  fallbackCount: number;
  fallbackRate: number;
}

export interface LensStats {
  windowDays: number;
  sinceIso: string;
  totalFires: number;
  totalFallbacks: number;
  fallbackRate: number;
  topFrameworks: FrameworkAgg[];
  surfaces: SurfaceAgg[];
}

export async function buildLensStats(args: { days: number }): Promise<LensStats> {
  const days = Math.max(1, Math.min(90, args.days));
  const since = new Date(Date.now() - days * 86_400_000);

  // Single read · group + count in JS since Prisma's groupBy on JSON
  // fields is awkward and the SystemMetric table is small enough to
  // scan (one row per fired-framework, ~50-200/day expected).
  const rows = await prisma.systemMetric.findMany({
    where: {
      metric: "ai.lens_fired",
      createdAt: { gte: since },
    },
    select: { value: true, tags: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  const frameworkBuckets = new Map<string, { count: number; scoreSum: number }>();
  const surfaceBuckets = new Map<string, { count: number; fallbackCount: number }>();

  let totalFires = 0;
  let totalFallbacks = 0;

  for (const row of rows) {
    const tags = row.tags as Record<string, unknown> | null;
    const framework =
      (typeof tags?.framework === "string" ? tags.framework : null) ?? "(unknown)";
    const surface =
      (typeof tags?.surface === "string" ? tags.surface : null) ?? "(unknown)";
    const isFallback = framework === "(fallback)";

    const fb = frameworkBuckets.get(framework) ?? { count: 0, scoreSum: 0 };
    fb.count += 1;
    fb.scoreSum += row.value;
    frameworkBuckets.set(framework, fb);

    const sb = surfaceBuckets.get(surface) ?? { count: 0, fallbackCount: 0 };
    sb.count += 1;
    if (isFallback) sb.fallbackCount += 1;
    surfaceBuckets.set(surface, sb);

    totalFires += 1;
    if (isFallback) totalFallbacks += 1;
  }

  const topFrameworks: FrameworkAgg[] = Array.from(frameworkBuckets.entries())
    .map(([framework, { count, scoreSum }]) => ({
      framework,
      count,
      avgScore: count > 0 ? Number((scoreSum / count).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const surfaces: SurfaceAgg[] = Array.from(surfaceBuckets.entries())
    .map(([surface, { count, fallbackCount }]) => ({
      surface,
      count,
      fallbackCount,
      fallbackRate:
        count > 0 ? Number(((fallbackCount / count) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    windowDays: days,
    sinceIso: since.toISOString(),
    totalFires,
    totalFallbacks,
    fallbackRate:
      totalFires > 0 ? Number(((totalFallbacks / totalFires) * 100).toFixed(1)) : 0,
    topFrameworks,
    surfaces,
  };
}
