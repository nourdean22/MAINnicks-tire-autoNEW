/**
 * lib/services/decision-detail.ts · misc-pages slice (2026-05-22 ·
 * legacy-modernizer REST→tRPC).
 *
 * The single-decision detail read + grade-update assembly · lifted
 * verbatim from app/api/decisions/[id]/route.ts (the GET's
 * decision + lineage + computed-timeline assembly, and the POST's
 * partial grade/outcome/review update with entity-audit). The legacy
 * REST endpoints AND the new `operator.decisionDetail` /
 * `operator.gradeDecision` tRPC procedures call the SAME functions ·
 * drift between consumers structurally impossible.
 *
 * Both functions return EXPLICIT, shallow shapes (`DecisionDetailView`
 * / `{ decision: DecisionRow }`). `MasteryDecision` has no Json
 * columns, but the anti-pattern lineage rows carry the
 * `BrainMemory.metadata` Json column — projected to `metadata:
 * unknown` (never the recursive Prisma `JsonValue`) so the AppRouter
 * type stays shallow · the same TS2589-prevention discipline as
 * `TaskEventRow` in lib/trpc/routers/task.ts.
 *
 * Date columns are projected to ISO `string` (matching the
 * `decision-replays` service precedent) · the tRPC layer runs no
 * transformer, so a `Date` return would be a string at runtime but
 * ambiguous at the type level. Returning `string` makes the procedure
 * type honest AND keeps the legacy REST JSON byte-identical (JSON
 * always serialized the Date to a string anyway).
 */

import { prisma } from "@/lib/prisma";
import { ServiceError } from "@/lib/utils/service-error";
import { logUpdate, stripNoise } from "@/lib/db/entity-audit";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

/** Flat decision row · Date columns projected to ISO string. Mirrors
 *  the page's `Decision` interface. */
export interface DecisionRow {
  id: number;
  date: string;
  title: string;
  domain: string | null;
  stakes: string | null;
  context: string | null;
  optionsConsidered: string | null;
  chosen: string | null;
  reasoning: string | null;
  predictedOutcome: string | null;
  emotionalState: string | null;
  reviewDate: string | null;
  actualOutcome: string | null;
  grade: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Flat sibling row · last-N same-domain decisions. */
export interface DecisionSiblingRow {
  id: number;
  date: string;
  title: string;
  grade: string | null;
  actualOutcome: string | null;
  reviewDate: string | null;
}

/** Flat anti-pattern lineage row · `metadata` Json projected to
 *  `unknown` (TS2589 firewall). */
export interface DecisionAntiPatternRow {
  key: string;
  content: string;
  seenCount: number | null;
  metadata: unknown;
}

export interface DecisionDetailView {
  decision: DecisionRow;
  lineage: {
    siblings: DecisionSiblingRow[];
    antiPatterns: DecisionAntiPatternRow[];
  };
  timeline: {
    ageDays: number;
    reviewDueDays: number | null;
    isReviewed: boolean;
    isOverdue: boolean;
  };
}

/**
 * Full decision detail · the decision row + same-domain sibling
 * lineage + matching anti-patterns + a computed timeline block.
 * Throws `ServiceError(…, 400)` for a bad id, `ServiceError(…, 404)`
 * when the decision doesn't resolve — the route + tRPC layer both
 * translate those identically.
 */
export async function getDecisionDetail(
  id: number,
): Promise<DecisionDetailView> {
  if (!Number.isInteger(id) || id <= 0) {
    throw new ServiceError("decision id must be a positive integer", 400);
  }

  const decision = await prisma.masteryDecision.findFirst({
    where: { id, deletedAt: null },
  });
  if (!decision) {
    throw new ServiceError(`decision ${id} not found`, 404);
  }

  // ── Lineage · siblings in the same domain ──────────────────────
  // Last 5 same-domain decisions excluding this one.
  const siblings = decision.domain
    ? await prisma.masteryDecision.findMany({
        where: {
          domain: decision.domain,
          deletedAt: null,
          id: { not: id },
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
  // Anti-pattern lessons whose domain matches. Cap at 3 most-revisited.
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
  const isReviewed =
    decision.actualOutcome !== null && decision.grade !== null;
  const isOverdue =
    !isReviewed && reviewDueDays !== null && reviewDueDays < 0;

  return {
    decision: {
      id: decision.id,
      date: decision.date,
      title: decision.title,
      domain: decision.domain,
      stakes: decision.stakes,
      context: decision.context,
      optionsConsidered: decision.optionsConsidered,
      chosen: decision.chosen,
      reasoning: decision.reasoning,
      predictedOutcome: decision.predictedOutcome,
      emotionalState: decision.emotionalState,
      reviewDate: decision.reviewDate,
      actualOutcome: decision.actualOutcome,
      grade: decision.grade,
      createdAt: decision.createdAt.toISOString(),
      updatedAt: decision.updatedAt.toISOString(),
    },
    lineage: {
      siblings,
      antiPatterns,
    },
    timeline: {
      ageDays,
      reviewDueDays,
      isReviewed,
      isOverdue,
    },
  };
}

export interface GradeDecisionInput {
  actualOutcome?: string;
  grade?: string;
  reviewDate?: string;
}

/**
 * Apply a partial grade/outcome/review update to a single decision.
 * Mirrors the legacy POST /api/decisions/[id]: only the provided
 * fields are written, the before/after diff is logged via the
 * universal entity-audit. Throws `ServiceError(…, 400/404)` on a bad
 * id / missing decision.
 */
export async function gradeDecision(
  id: number,
  input: GradeDecisionInput,
): Promise<{ decision: DecisionRow }> {
  if (!Number.isInteger(id) || id <= 0) {
    throw new ServiceError("decision id must be a positive integer", 400);
  }

  const before = await prisma.masteryDecision.findUnique({
    where: { id },
  });
  if (!before || before.deletedAt) {
    throw new ServiceError(`decision ${id} not found`, 404);
  }

  const updated = await prisma.masteryDecision.update({
    where: { id },
    data: {
      ...(input.actualOutcome !== undefined
        ? { actualOutcome: input.actualOutcome }
        : {}),
      ...(input.grade !== undefined ? { grade: input.grade } : {}),
      ...(input.reviewDate !== undefined
        ? { reviewDate: input.reviewDate }
        : {}),
    },
  });

  void logUpdate(
    "masteryDecision",
    String(updated.id),
    stripNoise(before as unknown as Record<string, unknown>),
    stripNoise(updated as unknown as Record<string, unknown>),
    { source: "service:decision-detail.gradeDecision", reason: "decision detail update" },
  );

  return {
    decision: {
      id: updated.id,
      date: updated.date,
      title: updated.title,
      domain: updated.domain,
      stakes: updated.stakes,
      context: updated.context,
      optionsConsidered: updated.optionsConsidered,
      chosen: updated.chosen,
      reasoning: updated.reasoning,
      predictedOutcome: updated.predictedOutcome,
      emotionalState: updated.emotionalState,
      reviewDate: updated.reviewDate,
      actualOutcome: updated.actualOutcome,
      grade: updated.grade,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    },
  };
}
