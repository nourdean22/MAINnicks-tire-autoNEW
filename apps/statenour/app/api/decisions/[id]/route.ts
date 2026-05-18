/**
 * GET  /api/decisions/[id] · v10.0.221 · single-decision detail.
 * POST /api/decisions/[id] · grade + edit a single decision.
 *
 * Powers the new /decisions/[id] detail page. Returns the full
 * MasteryDecision row plus a small lineage block:
 *   · sibling decisions in the same domain (last 5)
 *   · candidate anti-patterns whose tags overlap the decision's domain
 *   · time-since-creation + days-to-review countdown
 *
 * The lineage helps the operator review with full context:
 *   "what other decisions in this domain look like, what lessons
 *    might apply, when is this one due for review"
 *
 * Auth: owner only.
 */
import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { ServiceError } from "@/lib/utils/service-error";
import { logUpdate, stripNoise } from "@/lib/db/entity-audit";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

export const GET = apiHandler(
  async (_req, ctx) => {
    const params = (await ctx.params) ?? {};
    const numericId = Number(params.id);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      throw new ServiceError("decision id must be a positive integer", 400);
    }

    const decision = await prisma.masteryDecision.findFirst({
      where: { id: numericId, deletedAt: null },
    });
    if (!decision) {
      throw new ServiceError(`decision ${numericId} not found`, 404);
    }

    // ── Lineage · siblings in the same domain ──────────────────────
    // Last 5 same-domain decisions excluding this one. Gives the
    // operator pattern context: "is this domain trending up or down?"
    const siblings = decision.domain
      ? await prisma.masteryDecision.findMany({
          where: {
            domain: decision.domain,
            deletedAt: null,
            id: { not: numericId },
          },
          orderBy: { date: "desc" },
          take: 5,
          select: {
            id: true,
            date: true,
            title: true,
            grade: true,
            actualOutcome: true,
            reviewDate: true,
          },
        })
      : [];

    // ── Lineage · candidate anti-patterns ──────────────────────────
    // Anti-pattern lessons whose domain matches this decision's domain.
    // The operator might want to consult them before grading. Cap at
    // 3 most-revisited (most "earned" lessons surface first).
    const antiPatterns = decision.domain
      ? await prisma.brainMemory.findMany({
          where: {
            category: BRAIN_CATEGORIES.ANTI_PATTERN,
            deletedAt: null,
            metadata: { path: ["domain"], equals: decision.domain },
          },
          orderBy: { seenCount: "desc" },
          take: 3,
          select: {
            key: true,
            content: true,
            seenCount: true,
            metadata: true,
          },
        })
      : [];

    // ── Computed timeline fields ───────────────────────────────────
    const createdAtMs = decision.createdAt.getTime();
    const ageDays = Math.floor((Date.now() - createdAtMs) / 86400_000);
    const reviewDueDays = decision.reviewDate
      ? Math.floor(
          (new Date(decision.reviewDate).getTime() - Date.now()) / 86400_000,
        )
      : null;
    const isReviewed = decision.actualOutcome !== null && decision.grade !== null;
    const isOverdue =
      !isReviewed && reviewDueDays !== null && reviewDueDays < 0;

    return {
      decision,
      lineage: { siblings, antiPatterns },
      timeline: {
        ageDays,
        reviewDueDays,
        isReviewed,
        isOverdue,
      },
    };
  },
  { auth: "owner" },
);

/** Same shape as the legacy /api/decisions POST grade action — kept
 *  here so the new detail page can submit without a roundabout. */
export const POST = apiHandler(
  async (req, ctx) => {
    const params = (await ctx.params) ?? {};
    const numericId = Number(params.id);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      throw new ServiceError("decision id must be a positive integer", 400);
    }

    const body = (await req.json().catch(() => ({}))) as {
      actualOutcome?: string;
      grade?: string;
      reviewDate?: string;
    };

    const before = await prisma.masteryDecision.findUnique({
      where: { id: numericId },
    });
    if (!before || before.deletedAt) {
      throw new ServiceError(`decision ${numericId} not found`, 404);
    }

    const updated = await prisma.masteryDecision.update({
      where: { id: numericId },
      data: {
        ...(body.actualOutcome !== undefined ? { actualOutcome: body.actualOutcome } : {}),
        ...(body.grade !== undefined ? { grade: body.grade } : {}),
        ...(body.reviewDate !== undefined ? { reviewDate: body.reviewDate } : {}),
      },
    });

    void logUpdate(
      "masteryDecision",
      String(updated.id),
      stripNoise(before as unknown as Record<string, unknown>),
      stripNoise(updated as unknown as Record<string, unknown>),
      { source: "api:decisions.[id].POST", reason: "decision detail update" },
    );

    return { decision: updated };
  },
  { auth: "owner" },
);
