/**
 * lib/ai/reasoning/budget.ts · Phase H.3 (2026-05-18 PM)
 *
 * Daily spend cap for the Nick Reasoning Engine.
 *
 * Pre-H.3 the engine had no rate limit + no budget. Operator could
 * accidentally trigger 10 mega runs in 60s and burn $2-4 with zero
 * brakes. This module reads back the persisted reasoning_trace rows
 * (Phase H.2.2 wrote them, this module is the first reader) and
 * computes today's total spend per operator. Returns a verdict the
 * endpoint enforces before kicking off a run.
 *
 * Caps:
 *   · DEFAULT_DAILY_CAP_USD = $1.00 per day per operator (single-
 *     operator OS so "operator" is effectively a constant)
 *   · MEGA_PER_RUN_CAP_USD = $0.25 · single mega run can't claim
 *     more than this even if the daily cap has headroom
 *
 * Failure mode: if the reader fails for any reason, we DEFAULT TO
 * ALLOWING the run. Better to risk one extra run than to silently
 * block legitimate work because of a Prisma error.
 *
 * Used by · /api/nick/reason · /api/nick/reason/stream.
 */

import { prisma } from "@/lib/prisma";
import type { ReasoningTier } from "./types";

export const DEFAULT_DAILY_CAP_USD = 1.0;
export const MEGA_PER_RUN_CAP_USD = 0.25;

export interface BudgetVerdict {
  /** Whether to allow the run */
  allow: boolean;
  /** Today's spend in USD before this run · 0 if unknown */
  spentTodayUsd: number;
  /** Configured cap */
  capUsd: number;
  /** Estimated cost of THIS run (pre-execution guess) */
  estimatedRunUsd: number;
  /** Human-readable reason · used by the UI when allow=false */
  reason: string;
}

/** Pre-run cost estimate per tier. Conservative · over-estimates so
 *  the cap is hit before we actually exceed it. */
function estimateTierCost(tier: ReasoningTier): number {
  switch (tier) {
    case "mega":
      return 0.25;
    case "thorough":
      return 0.12;
    case "deep":
      return 0.025;
    case "standard":
      return 0.006;
    case "quick":
    default:
      return 0.0005;
  }
}

/** Sum today's spend by reading back BrainMemory(category="reasoning_trace")
 *  rows created since midnight ET. Each row carries metadata.usd from
 *  Phase H.2.2 persistence. */
async function getTodaySpendUsd(): Promise<number> {
  try {
    // ET midnight · matches the operator's local-day rhythm
    const startOfDayEt = new Date();
    const etDateStr = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(startOfDayEt);
    const startGte = new Date(`${etDateStr}T00:00:00-05:00`);

    const rows = await prisma.brainMemory.findMany({
      where: {
        category: "reasoning_trace",
        createdAt: { gte: startGte },
        deletedAt: null,
      },
      select: { metadata: true },
      take: 500,
    });
    let total = 0;
    for (const r of rows) {
      const m = (r.metadata ?? null) as { usd?: number } | null;
      const usd = typeof m?.usd === "number" ? m.usd : 0;
      if (Number.isFinite(usd)) total += usd;
    }
    return Math.round(total * 1000) / 1000;
  } catch {
    // Open the gate if the read fails · don't block work on a tooling bug
    return 0;
  }
}

export async function checkBudget(
  tier: ReasoningTier,
  options?: { capUsd?: number },
): Promise<BudgetVerdict> {
  const capUsd = options?.capUsd ?? DEFAULT_DAILY_CAP_USD;
  const spentTodayUsd = await getTodaySpendUsd();
  const estimatedRunUsd = estimateTierCost(tier);

  // Mega per-run hard cap · even if daily cap has room, one mega run
  // can't claim more than MEGA_PER_RUN_CAP_USD. Protects against the
  // estimate being wildly low for a particular run.
  if (tier === "mega" && estimatedRunUsd > MEGA_PER_RUN_CAP_USD) {
    return {
      allow: false,
      spentTodayUsd,
      capUsd,
      estimatedRunUsd,
      reason: `Mega tier estimated at $${estimatedRunUsd.toFixed(2)} exceeds per-run cap $${MEGA_PER_RUN_CAP_USD.toFixed(2)}.`,
    };
  }

  // Daily cap
  if (spentTodayUsd + estimatedRunUsd > capUsd) {
    return {
      allow: false,
      spentTodayUsd,
      capUsd,
      estimatedRunUsd,
      reason: `Daily reasoning cap would be exceeded · $${spentTodayUsd.toFixed(3)} spent + $${estimatedRunUsd.toFixed(3)} estimate > $${capUsd.toFixed(2)} cap.`,
    };
  }

  return {
    allow: true,
    spentTodayUsd,
    capUsd,
    estimatedRunUsd,
    reason: `Within budget · $${spentTodayUsd.toFixed(3)} spent + $${estimatedRunUsd.toFixed(3)} estimate ≤ $${capUsd.toFixed(2)} cap.`,
  };
}

export const __internals = { estimateTierCost, getTodaySpendUsd };
