/**
 * Second-Location Ranker · v10.0.526 · Arc C · Feature 7
 *
 * Wraps the pure scorer in lib/services/location-feasibility.ts with
 * the only two non-pure concerns: sorting + persisting the monthly
 * top-N rankings to BrainMemory.
 *
 * NO new tables. NO duplicate data. Storage shape:
 *   BrainMemory(category="location_ranking", key="monthly_YYYY-MM")
 *
 * `content` is the prose summary (top 5 addresses + tiers · operator
 * scan-friendly). `metadata` is the structured JSON: full top-20
 * with normalizedScore · tier · reasoning · weakest/strongest.
 *
 * Why "monthly_YYYY-MM" not "monthly_YYYY-MM-DD": one ranking per ET
 * month. Mid-month re-runs UPDATE the same row (BrainMemory enforces
 * @@unique([category, key])). Operator wants a stable handle.
 */

import { prisma } from "@/lib/prisma";
import {
  scoreLocation,
  type LocationParams,
  type LocationScore,
} from "./location-feasibility";

/**
 * Score every candidate · sort by normalizedScore desc. Pure modulo
 * the scorer, which is itself pure. Exported so the API + cron both
 * use the identical path.
 */
export function rankCandidates(candidates: LocationParams[]): LocationScore[] {
  const scored = candidates.map((c) => scoreLocation(c));
  scored.sort((a, b) => b.normalizedScore - a.normalizedScore);
  return scored;
}

/**
 * Month key in ET · same format the rest of the codebase uses
 * (morning-brief · cost-slo-check).
 */
export function etMonthKey(date: Date = new Date()): string {
  const iso = date.toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
  // iso is YYYY-MM-DD · take the YYYY-MM prefix.
  return iso.slice(0, 7);
}

/**
 * Build the prose preview the operator sees in BrainMemory.content.
 * Top 5 only · the full 20 lives in metadata for programmatic reads.
 */
function previewLines(rankings: LocationScore[]): string {
  const head = rankings.slice(0, 5);
  if (head.length === 0) return "No candidates ranked.";
  const lines: string[] = [
    `Top ${head.length} of ${rankings.length} candidate(s):`,
  ];
  head.forEach((r, i) => {
    lines.push(
      `${i + 1}. ${r.address} · ${r.normalizedScore}/100 · tier ${r.tier}`,
    );
  });
  return lines.join("\n");
}

export interface PersistResult {
  monthKey: string;
  count: number;
  topAddress: string | null;
  brainMemoryId: string | null;
}

/**
 * Persist the top-20 to BrainMemory · idempotent within an ET month.
 * Returns a small status object · callers (API route · cron) decide
 * what to do with it.
 *
 * Catches DB errors and returns brainMemoryId=null. We never throw
 * from this path · the ranking itself is the valuable output, not
 * the audit row.
 */
export async function persistRanking(
  rankings: LocationScore[],
  monthKey: string = etMonthKey(),
): Promise<PersistResult> {
  const top20 = rankings.slice(0, 20);
  const content = previewLines(top20);

  const metadata = {
    monthKey,
    candidateCount: rankings.length,
    rankedAt: new Date().toISOString(),
    rankings: top20.map((r) => ({
      address: r.address,
      normalizedScore: r.normalizedScore,
      tier: r.tier,
      strongest: r.strongestDimension,
      weakest: r.weakestDimension,
      reasoning: r.reasoning,
      warnings: r.warnings,
    })),
  };

  try {
    const row = await prisma.brainMemory.upsert({
      where: {
        category_key: {
          category: "location_ranking",
          key: `monthly_${monthKey}`,
        },
      },
      create: {
        category: "location_ranking",
        key: `monthly_${monthKey}`,
        content,
        confidence: 0.9,
        source: "service:location-rank",
        createdBy: "system",
        metadata: metadata as unknown as Parameters<
          typeof prisma.brainMemory.create
        >[0]["data"]["metadata"],
      },
      update: {
        content,
        confidence: 0.9,
        metadata: metadata as unknown as Parameters<
          typeof prisma.brainMemory.update
        >[0]["data"]["metadata"],
      },
      select: { id: true },
    });

    return {
      monthKey,
      count: top20.length,
      topAddress: top20[0]?.address ?? null,
      brainMemoryId: row.id,
    };
  } catch {
    return {
      monthKey,
      count: top20.length,
      topAddress: top20[0]?.address ?? null,
      brainMemoryId: null,
    };
  }
}

/**
 * Look up the persisted ranking for an ET month. Used by the GET
 * /api/business/location-ranking endpoint and the future operator
 * dashboard.
 */
export async function getPersistedRanking(
  monthKey: string = etMonthKey(),
): Promise<{
  monthKey: string;
  found: boolean;
  content: string | null;
  metadata: unknown;
  updatedAt: Date | null;
}> {
  try {
    const row = await prisma.brainMemory.findUnique({
      where: {
        category_key: {
          category: "location_ranking",
          key: `monthly_${monthKey}`,
        },
      },
      select: { content: true, metadata: true, updatedAt: true },
    });
    if (!row) {
      return { monthKey, found: false, content: null, metadata: null, updatedAt: null };
    }
    return {
      monthKey,
      found: true,
      content: row.content,
      metadata: row.metadata,
      updatedAt: row.updatedAt,
    };
  } catch {
    return { monthKey, found: false, content: null, metadata: null, updatedAt: null };
  }
}
