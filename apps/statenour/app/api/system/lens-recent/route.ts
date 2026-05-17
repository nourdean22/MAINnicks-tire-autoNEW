/**
 * GET /api/system/lens-recent · v10.0.300 · last N strategic-frameworks
 * lens fires for the live ticker on Ultron HQ.
 *
 * The recordLensFire helper writes one SystemMetric row per fired
 * framework with metric="ai.lens_fired" + tags.{surface, framework}.
 * This route returns the most recent ~10 so the LensFireTicker can
 * cycle through them as proof the AI is actively reasoning with
 * the strategic-frameworks registry.
 *
 * Auth · owner.
 */
import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

interface FireRow {
  id: string;
  surface: string;
  framework: string;
  at: string;
}

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const limit = Math.max(
    1,
    Math.min(50, parseInt(url.searchParams.get("limit") ?? "10", 10) || 10),
  );

  const rows = await prisma.systemMetric.findMany({
    where: { metric: "ai.lens_fired" },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      tags: true,
      createdAt: true,
    },
  });

  const fires: FireRow[] = rows.map((r) => {
    const tags = (r.tags ?? {}) as { surface?: string; framework?: string };
    return {
      id: r.id,
      surface: tags.surface ?? "unknown",
      framework: tags.framework ?? "unknown",
      at: r.createdAt.toISOString(),
    };
  });

  return { fires, count: fires.length };
}, { auth: "owner" });
