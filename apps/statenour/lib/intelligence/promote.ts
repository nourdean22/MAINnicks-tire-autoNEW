/**
 * IntelligenceClaim -> BrainMemory promotion — the governed pipeline's final leg.
 *
 * The intelligence pipeline (RegisteredSource -> SourceDocument -> IntelligenceClaim,
 * via lib/intelligence/ingest.ts + grounding.ts) already produces provenance +
 * confidence + contradiction-gated claims, but nothing carried them INTO the brain.
 * This is that missing leg.
 *
 * SAFETY MODEL (mirrors lib/brain/belief-harvester.ts belief_candidate flow):
 * promoted facts land in `research_claim_candidate`, NOT the trusted `research_claim`.
 * That category is intentionally absent from memory-recall.ts's CONTEXT_CATEGORIES
 * whitelist, so a promoted fact is queryable/reviewable but can NEVER leak into chat
 * recall until a human promotes it (candidate -> trusted) — exactly like
 * belief_candidate -> belief. Every row carries full provenance (claim -> document ->
 * source) so any fact is traceable and reversible (soft-delete by claimId). Writes
 * are idempotent via the (category, key) unique and bounded by `max` per run.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("intelligence/promote");

/** Only claims at least this confident are worth carrying into the brain. */
export const PROMOTION_CONFIDENCE_FLOOR = 0.7;
/** Promoted rows are stamped low-trust so nothing treats them as settled fact. */
export const CANDIDATE_CONFIDENCE = 0.3;
/** Per-run safety cap — bounded blast radius (guardrail). */
export const DEFAULT_MAX_PROMOTIONS = 25;
/** Only fully source-supported research CLAIMS promote — never questions/actions/contradictions. */
const PROMOTABLE_STATUS = "source_supported";
const PROMOTABLE_CATEGORY = BRAIN_CATEGORIES.RESEARCH_CLAIM;

export interface PromotableClaim {
  id: string;
  text: string;
  category: string;
  status: string;
  confidence: number;
  verificationScore: number;
  bestMatchChunk: string | null;
  documentId: string;
  sourceId: string | null;
}

export interface CandidateMemoryInput {
  category: string;
  key: string;
  content: string;
  confidence: number;
  source: string;
  createdBy: string;
  metadata: Record<string, unknown>;
}

export interface PromotionResult {
  examined: number;
  promoted: number;
  skipped: number;
  promotedClaimIds: string[];
}

/**
 * PURE. A claim is promotable iff it is a fully source-supported research claim
 * above the confidence floor with real text.
 */
export function isPromotable(
  claim: Pick<PromotableClaim, "text" | "category" | "status" | "confidence">,
  floor = PROMOTION_CONFIDENCE_FLOOR,
): boolean {
  return (
    claim.status === PROMOTABLE_STATUS &&
    claim.category === PROMOTABLE_CATEGORY &&
    claim.confidence >= floor &&
    typeof claim.text === "string" &&
    claim.text.trim().length > 0
  );
}

/**
 * PURE. Build the low-trust candidate BrainMemory row for a claim, with full
 * reversible provenance. Deterministic key (`intel_<claimId>`) so re-promotion
 * upserts in place instead of duplicating.
 */
export function buildCandidateMemory(
  claim: PromotableClaim,
  promotedAtIso: string,
): CandidateMemoryInput {
  return {
    category: BRAIN_CATEGORIES.RESEARCH_CLAIM_CANDIDATE,
    key: `intel_${claim.id}`,
    content: claim.text.trim(),
    confidence: CANDIDATE_CONFIDENCE,
    source: "intelligence-pipeline",
    createdBy: "cron:intelligence-promote",
    metadata: {
      claimId: claim.id,
      documentId: claim.documentId,
      sourceId: claim.sourceId,
      originalCategory: claim.category,
      originalConfidence: claim.confidence,
      verificationScore: claim.verificationScore,
      status: claim.status,
      bestMatchChunk: claim.bestMatchChunk,
      trust: "low",
      requiresHumanPromotion: true,
      promotedAt: promotedAtIso,
    },
  };
}

/**
 * Promote source-supported research claims into the brain as low-trust candidates.
 * Idempotent (upsert on category+key) and bounded by `max`. When `claimIds` is
 * given, only those claims are considered (used at the tail of runIngestion);
 * otherwise the most-recent qualifying claims are swept (used by a future cron).
 * Never resurrects a human-soft-deleted candidate.
 */
export async function promoteIntelligenceClaims(
  opts: { claimIds?: string[]; max?: number; now?: Date } = {},
): Promise<PromotionResult> {
  const max = Math.max(0, opts.max ?? DEFAULT_MAX_PROMOTIONS);
  if (max === 0) {
    return { examined: 0, promoted: 0, skipped: 0, promotedClaimIds: [] };
  }
  if (opts.claimIds && opts.claimIds.length === 0) {
    return { examined: 0, promoted: 0, skipped: 0, promotedClaimIds: [] };
  }

  const rows = await prisma.intelligenceClaim.findMany({
    where: {
      status: PROMOTABLE_STATUS,
      category: PROMOTABLE_CATEGORY,
      confidence: { gte: PROMOTION_CONFIDENCE_FLOOR },
      ...(opts.claimIds ? { id: { in: opts.claimIds } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: max,
    select: {
      id: true,
      text: true,
      category: true,
      status: true,
      confidence: true,
      verificationScore: true,
      bestMatchChunk: true,
      documentId: true,
      document: { select: { sourceId: true } },
    },
  });

  const promotedAtIso = (opts.now ?? new Date()).toISOString();
  const promotedClaimIds: string[] = [];
  let skipped = 0;

  for (const r of rows) {
    const claim: PromotableClaim = {
      id: r.id,
      text: r.text,
      category: r.category,
      status: r.status,
      confidence: r.confidence,
      verificationScore: r.verificationScore,
      bestMatchChunk: r.bestMatchChunk,
      documentId: r.documentId,
      sourceId: r.document?.sourceId ?? null,
    };
    // Belt + suspenders: the query already filters, but re-check (esp. empty text).
    if (!isPromotable(claim)) {
      skipped++;
      continue;
    }
    const mem = buildCandidateMemory(claim, promotedAtIso);
    try {
      // Do NOT touch deletedAt on update — a human soft-delete of a bad candidate
      // must stay deleted rather than be resurrected on the next ingestion.
      await prisma.brainMemory.upsert({
        where: { category_key: { category: mem.category, key: mem.key } },
        create: {
          category: mem.category,
          key: mem.key,
          content: mem.content,
          confidence: mem.confidence,
          source: mem.source,
          createdBy: mem.createdBy,
          metadata: mem.metadata as Prisma.InputJsonValue,
        },
        update: {
          content: mem.content,
          confidence: mem.confidence,
          metadata: mem.metadata as Prisma.InputJsonValue,
          lastSeen: opts.now ?? new Date(),
          seenCount: { increment: 1 },
        },
      });
      promotedClaimIds.push(r.id);
    } catch (err) {
      skipped++;
      log.warn("promote_claim_failed", {
        claimId: r.id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  log.info("intelligence_claims_promoted", {
    examined: rows.length,
    promoted: promotedClaimIds.length,
    skipped,
  });

  return {
    examined: rows.length,
    promoted: promotedClaimIds.length,
    skipped,
    promotedClaimIds,
  };
}
