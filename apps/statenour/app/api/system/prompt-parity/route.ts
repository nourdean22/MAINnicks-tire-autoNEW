/**
 * GET /api/system/prompt-parity · v10.0.465
 *
 * Returns aggregated v1/v2 prompt shadow-mode telemetry. Mirrors the
 * logic of scripts/prompt-shadow-summary.ts (v10.0.463) but exposed
 * as an API endpoint for the operator dashboard.
 *
 * Cutover criteria evaluated:
 *   · Criterion 1 · structural drift · sectionsOnlyInV1/V2 ≤ 1% of turns
 *   · Criterion 2 · token economy · avg deltaPct ∈ [-40%, +5%]
 *   · Criterion 3 · zero shadow build failures
 *
 * (Criterion 4 = judge-eval delta · separate script-only path because
 *  it burns LLM tokens · not exposed via API)
 *
 * Auth · session required (operator-only).
 * Cache · none · always fresh.
 *
 * Skill provenance: prompt-engineering + claude-api +
 * production-code-audit (top-50 always-on floor).
 *
 * v10.0.529.106 · Wave 79 · migrated to apiHandler. No external
 * consumers · returning unwrapped data lets the envelope wrap cleanly.
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

interface Tags {
  tier?: string;
  slot?: string;
  builderVersion?: string;
  charsV1?: number;
  charsV2?: number;
}

interface PerTierStats {
  tier: string;
  turnCount: number;
  avgCharsV1: number;
  avgCharsV2: number;
  avgDeltaPct: number;
  sumSectionsOnlyV1: number;
  sumSectionsOnlyV2: number;
  buildFailures: number;
  structuralDriftPass: boolean;
  tokenEconomyPass: boolean;
  buildFailuresPass: boolean;
}

export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    const days = Number(url.searchParams.get("days")) || 7;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const rows = await prisma.systemMetric.findMany({
      where: { source: "prompt-shadow", createdAt: { gte: since } },
      select: { metric: true, value: true, tags: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    if (rows.length === 0) {
      return {
        status: "no_data",
        since: since.toISOString(),
        days,
        message:
          "No prompt-shadow telemetry · enable NICK_PRIME_PROMPT=shadow in env vars",
      };
    }

    const tierBuckets = new Map<string, typeof rows>();
    for (const r of rows) {
      const tier = ((r.tags as Tags | null)?.tier ?? "?") as string;
      const list = tierBuckets.get(tier) ?? [];
      list.push(r);
      tierBuckets.set(tier, list);
    }

    const perTier: PerTierStats[] = [];
    for (const [tier, list] of tierBuckets) {
      const charDelta = list.filter((r) => r.metric === "prompt.shadow.chars_delta");
      const charDeltaPct = list.filter((r) => r.metric === "prompt.shadow.chars_delta_pct");
      const sections1 = list.filter((r) => r.metric === "prompt.shadow.sections_only_v1");
      const sections2 = list.filter((r) => r.metric === "prompt.shadow.sections_only_v2");
      const failures = list.filter((r) => r.metric === "prompt.shadow.build_failures");

      const turnCount = charDelta.length;
      const avgCharsV1 =
        turnCount > 0
          ? charDelta.reduce((s, r) => s + (Number((r.tags as Tags | null)?.charsV1) || 0), 0) / turnCount
          : 0;
      const avgCharsV2 =
        turnCount > 0
          ? charDelta.reduce((s, r) => s + (Number((r.tags as Tags | null)?.charsV2) || 0), 0) / turnCount
          : 0;
      const avgDeltaPct =
        charDeltaPct.length > 0
          ? charDeltaPct.reduce((s, r) => s + r.value, 0) / charDeltaPct.length
          : 0;
      const sumSectionsOnlyV1 = sections1.reduce((s, r) => s + r.value, 0);
      const sumSectionsOnlyV2 = sections2.reduce((s, r) => s + r.value, 0);
      const buildFailures = failures.length;

      perTier.push({
        tier,
        turnCount,
        avgCharsV1: Math.round(avgCharsV1),
        avgCharsV2: Math.round(avgCharsV2),
        avgDeltaPct: Math.round(avgDeltaPct * 10) / 10,
        sumSectionsOnlyV1,
        sumSectionsOnlyV2,
        buildFailures,
        structuralDriftPass:
          turnCount > 0 &&
          sumSectionsOnlyV1 / turnCount <= 0.01 &&
          sumSectionsOnlyV2 / turnCount <= 0.01,
        tokenEconomyPass: avgDeltaPct >= -40 && avgDeltaPct <= 5,
        buildFailuresPass: buildFailures === 0,
      });
    }

    perTier.sort((a, b) => b.turnCount - a.turnCount);

    const overall = {
      totalTurns: perTier.reduce((s, t) => s + t.turnCount, 0),
      totalBuildFailures: perTier.reduce((s, t) => s + t.buildFailures, 0),
      allTiersStructuralDriftPass: perTier.every((t) => t.structuralDriftPass),
      allTiersTokenEconomyPass: perTier.every((t) => t.tokenEconomyPass),
      allTiersBuildFailuresPass: perTier.every((t) => t.buildFailuresPass),
    };

    return {
      status: "ok",
      since: since.toISOString(),
      days,
      overall,
      perTier,
    };
  },
  { auth: "owner" },
);
