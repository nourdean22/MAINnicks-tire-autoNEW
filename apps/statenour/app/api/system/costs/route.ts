/**
 * /api/system/costs — operator-grade cost+latency+health rollup.
 *
 * v6 · BATCH 2 · Apr 28. Goes deeper than /api/system/ai-cost (which
 * just shows by-feature/by-model spend). This endpoint adds:
 *   · per-model latency p50/p95/p99 + error rate
 *   · live provider health (quota breakers, tool support, recent errors)
 *   · daily budget gauge with burn-rate
 *   · today's image vs chat split
 *
 * Used by /system/costs page. Auth: session cookie.
 *
 * v10.0.529.106 · Wave 79 · migrated to apiHandler. The page reads
 * top-level keys (data.budget.limit, etc) so we return raw
 * NextResponse to preserve the existing shape · apiHandler still
 * provides rate-limit, auth, audit trace IDs, and error sanitization.
 */

import { NextResponse } from "next/server";
import { apiHandler } from "@/lib/utils/http";
import { getModelLatencyStats, getAiUsageStats, getModelLatencyTrend } from "@/lib/ai/track";
import { getProviderHealth } from "@/lib/ai/provider-health";
import { checkBudget } from "@/lib/ai/budget";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const IMAGE_MODELS = new Set([
  "recraft-v4",
  "z-image-turbo",
  "flux-2-pro",
  "seedream-v4",
  "nano-banana-2",
  "qwen-image",
  "venice-image",
]);

export const GET = apiHandler(
  async (req) => {
    const { searchParams } = new URL(req.url);
    const days = Math.max(1, Math.min(90, Number(searchParams.get("days") ?? "7")));

    const t0 = Date.now();
    const [latency, latencyTrend, usage, health, budget, imageVsChat, calibration] = await Promise.all([
      getModelLatencyStats(days),
      getModelLatencyTrend(days),
      getAiUsageStats(days),
      getProviderHealth(),
      checkBudget(),
      getImageVsChatToday(),
      // v7 · 2H · Calibration — Nick's prediction track record
      (async () => {
        try {
          const { getCalibrationStats } = await import("@/lib/ai/outcome-calibration");
          return await getCalibrationStats(30);
        } catch {
          return null;
        }
      })(),
    ]);
    const buildMs = Date.now() - t0;

    // Tool-calling support matrix — flag models that silently strip tools
    const toolSupport = latency.map((l) => ({
      model: l.model,
      calls: l.calls,
      supportsTools: !["venice-uncensored"].includes(l.model),
    }));

    // Slow-model leaderboard — sort by p95 desc, only models with >5 calls
    const slowestModels = [...latency]
      .filter((l) => l.calls >= 5)
      .sort((a, b) => b.p95Ms - a.p95Ms)
      .slice(0, 10);

    // Highest error-rate leaderboard
    const errorProneModels = [...latency]
      .filter((l) => l.calls >= 5)
      .sort((a, b) => b.errorRate - a.errorRate)
      .slice(0, 10)
      .filter((l) => l.errorRate > 0);

    return NextResponse.json({
      ok: true,
      window: { days },
      buildMs,
      budget,
      health,
      usage,
      latency,
      latencyTrend,
      calibration,
      slowestModels,
      errorProneModels,
      toolSupport,
      imageVsChat,
    });
  },
  { auth: "owner" },
);

async function getImageVsChatToday(): Promise<{
  imageCalls: number;
  imageCostCents: number;
  chatCalls: number;
  chatCostCents: number;
}> {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const rows = await prisma.aiGeneration
    .groupBy({
      by: ["model"],
      where: { createdAt: { gte: todayStart } },
      _count: { _all: true },
      _sum: { costCents: true },
    })
    .catch(() => [] as Array<{ model: string; _count: { _all: number }; _sum: { costCents: number | null } }>);

  let imageCalls = 0;
  let imageCostCents = 0;
  let chatCalls = 0;
  let chatCostCents = 0;
  for (const r of rows) {
    const isImage = IMAGE_MODELS.has(r.model.toLowerCase());
    if (isImage) {
      imageCalls += r._count._all;
      imageCostCents += r._sum.costCents ?? 0;
    } else {
      chatCalls += r._count._all;
      chatCostCents += r._sum.costCents ?? 0;
    }
  }
  return { imageCalls, imageCostCents, chatCalls, chatCostCents };
}
