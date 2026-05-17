/**
 * GET /api/system/pricing-advisory · v10.0.526 · Arc C Feature 3
 *
 * Owner-facing read of the latest weekly pricing advisory. Powers
 * the Ultron tile + future /admin/pricing-advisory operator surface.
 *
 * Returns the most-recent BrainMemory row with category="pricing_
 * advisory" AND key like "weekly_%". Cache rows (key like
 * "competitor_%") are intentionally excluded so the tile renders
 * the actual advisory, not the per-category cache.
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import type { AdvisorySnapshot } from "@/lib/services/pricing-advisor";

export const dynamic = "force-dynamic";

export const GET = apiHandler(
  async () => {
    const latest = await prisma.brainMemory
      .findFirst({
        where: {
          category: "pricing_advisory",
          key: { startsWith: "weekly_" },
          deletedAt: null,
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          key: true,
          content: true,
          confidence: true,
          createdAt: true,
          metadata: true,
        },
      })
      .catch(() => null);

    if (!latest) {
      return {
        hasAdvisory: false,
        reason: "no_advisory_yet",
      };
    }

    const meta = latest.metadata as { snapshot?: AdvisorySnapshot } | null;
    const snapshot = meta?.snapshot ?? null;

    return {
      hasAdvisory: true,
      generatedAt: latest.createdAt.toISOString(),
      date: latest.key.replace(/^weekly_/, ""),
      headline: latest.content,
      confidence: latest.confidence,
      snapshot,
    };
  },
  { auth: "owner" },
);
