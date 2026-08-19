/**
 * GET /api/knowledge/pipeline-status · 2026-08-19 (Brain wave 2).
 *
 * WHY THIS EXISTS: the Review tab rendered an empty list and called it a
 * day. Measured in prod 2026-08-19, that emptiness was hiding a structural
 * dead end:
 *
 *   intelligence_claims:  876 unverified · 17 weak_support · 0 source_supported
 *   best verification_score ever recorded: 0.58
 *   promotion gate (PROMOTION path in lib/intelligence/promote.ts):
 *     status must be "source_supported", i.e. score >= 0.75
 *   research_claim_candidate rows in existence: 0
 *
 * 893 claims have been ingested and NOT ONE has ever been promotable —
 * the best score in the entire corpus is 0.17 below the gate. And
 * `source_supported` means "cosine >= 0.75 against OUR OWN MEMORY"
 * (lib/intelligence/grounding.ts), i.e. the gate rewards claims that
 * already resemble something we believe. For genuinely new research —
 * the only kind worth ingesting — that is the condition LEAST likely to
 * hold. The gate is anti-correlated with novelty.
 *
 * That is a product decision for the operator (lower the gate? change the
 * grounding signal? retire the lane?), NOT something to silently patch.
 * So this route reports the real numbers and the surface renders them,
 * because a queue that can never fill should say so instead of looking
 * merely quiet.
 */
import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import {
  GROUNDING_STRONG_THRESHOLD,
  GROUNDING_WEAK_THRESHOLD,
} from "@/lib/intelligence/grounding";

export const dynamic = "force-dynamic";

export const GET = apiHandler(
  async () => {
    // Each read is independently guarded: a dead-ended pipeline diagnostic
    // must never itself become a dead end.
    const [byStatus, best, candidates, claimTotal] = await Promise.allSettled([
      prisma.intelligenceClaim.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      prisma.intelligenceClaim.aggregate({ _max: { verificationScore: true } }),
      prisma.brainMemory.count({
        where: {
          category: BRAIN_CATEGORIES.RESEARCH_CLAIM_CANDIDATE,
          deletedAt: null,
        },
      }),
      prisma.intelligenceClaim.count(),
    ]);

    const statusCounts =
      byStatus.status === "fulfilled"
        ? byStatus.value
            .map((r) => ({ status: r.status, count: r._count._all }))
            .sort((a, b) => b.count - a.count)
        : null;
    const bestScore =
      best.status === "fulfilled" ? (best.value._max.verificationScore ?? null) : null;
    const candidateCount = candidates.status === "fulfilled" ? candidates.value : null;
    const totalClaims = claimTotal.status === "fulfilled" ? claimTotal.value : null;

    const promotable =
      statusCounts?.find((s) => s.status === "source_supported")?.count ?? 0;

    // The gate is unreachable when the whole corpus tops out below it.
    //
    // `statusCounts !== null` is LOAD-BEARING, not defensive noise. Without
    // it, a REJECTED status query leaves statusCounts null, `promotable`
    // falls back to 0 via the `?? 0` above, and this flag would flip true —
    // rendering "none has ever been promotable · this queue cannot fill"
    // off a read that simply FAILED. That is the fail-open defect of the
    // 2026-08-19 health sweep, inverted: asserting alarming certainty from
    // missing data instead of health from missing data. Both are lies.
    // Every input must be present before the claim is made; otherwise the
    // surface reports "unknown".
    const gateUnreachable =
      statusCounts !== null &&
      bestScore !== null &&
      totalClaims !== null &&
      totalClaims > 0 &&
      promotable === 0 &&
      bestScore < GROUNDING_STRONG_THRESHOLD;

    return {
      totalClaims,
      statusCounts,
      bestVerificationScore: bestScore,
      promotableNow: promotable,
      candidateRows: candidateCount,
      thresholds: {
        strong: GROUNDING_STRONG_THRESHOLD,
        weak: GROUNDING_WEAK_THRESHOLD,
      },
      gateUnreachable,
      /** Stated once, here, so every surface says the same true thing. */
      gateMeaning:
        "source_supported = cosine similarity >= 0.75 against our OWN memory — self-corroboration, never independent verification. New research is the case least likely to clear it.",
      degraded: [
        byStatus.status === "rejected" ? "status_counts" : null,
        best.status === "rejected" ? "best_score" : null,
        candidates.status === "rejected" ? "candidate_rows" : null,
        claimTotal.status === "rejected" ? "claim_total" : null,
      ].filter(Boolean),
    };
  },
  { auth: "owner" },
);
