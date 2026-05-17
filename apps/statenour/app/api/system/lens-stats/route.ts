/**
 * GET /api/system/lens-stats — strategic-frameworks lens-firing aggregates.
 *
 * v10.0.265 · operational visibility for the 8 AI surfaces wired with
 * lens injection (chat · assist · coach-goal · review · teach · tasks ·
 * suggest-goals · nick-noticed). Reads SystemMetric rows where
 * metric = "ai.lens_fired" (written by recordLensFire helper).
 *
 * Returns 3 aggregations ·
 *   · top-fired frameworks (count + avg score) over the window
 *   · per-surface breakdown (counts per AI surface)
 *   · fallback rate (how often the generic block fires vs specific)
 *
 * Query params ·
 *   ?days=7   · window length (default 7, max 90)
 *
 * Auth · owner.
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

interface FrameworkAgg {
  framework: string;
  count: number;
  avgScore: number;
}

interface SurfaceAgg {
  surface: string;
  count: number;
  fallbackCount: number;
  fallbackRate: number;
}

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const days = Math.max(1, Math.min(90, parseInt(url.searchParams.get("days") ?? "7", 10) || 7));
  const since = new Date(Date.now() - days * 86_400_000);

  // Single read · we'll group + count in JS since Prisma's groupBy on
  // JSON fields is awkward and the SystemMetric table is small enough
  // to scan (one row per fired-framework, ~50-200/day expected).
  const rows = await prisma.systemMetric.findMany({
    where: {
      metric: "ai.lens_fired",
      createdAt: { gte: since },
    },
    select: { value: true, tags: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  // ── Per-framework aggregation ─────────────────────────────────────
  const frameworkBuckets = new Map<string, { count: number; scoreSum: number }>();
  // ── Per-surface aggregation ───────────────────────────────────────
  const surfaceBuckets = new Map<string, { count: number; fallbackCount: number }>();

  let totalFires = 0;
  let totalFallbacks = 0;

  for (const row of rows) {
    const tags = row.tags as Record<string, unknown> | null;
    const framework = (typeof tags?.framework === "string" ? tags.framework : null) ?? "(unknown)";
    const surface = (typeof tags?.surface === "string" ? tags.surface : null) ?? "(unknown)";
    const isFallback = framework === "(fallback)";

    // Framework counts (fallback gets its own bucket)
    const fb = frameworkBuckets.get(framework) ?? { count: 0, scoreSum: 0 };
    fb.count += 1;
    fb.scoreSum += row.value;
    frameworkBuckets.set(framework, fb);

    // Surface counts + fallback rate
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
      fallbackRate: count > 0 ? Number(((fallbackCount / count) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    windowDays: days,
    sinceIso: since.toISOString(),
    totalFires,
    totalFallbacks,
    fallbackRate: totalFires > 0 ? Number(((totalFallbacks / totalFires) * 100).toFixed(1)) : 0,
    topFrameworks,
    surfaces,
  };
}, { auth: "owner" });
