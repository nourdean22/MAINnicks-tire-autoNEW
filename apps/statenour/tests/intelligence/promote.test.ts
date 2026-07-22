import { describe, expect, it } from "vitest";
import {
  isPromotable,
  buildCandidateMemory,
  PROMOTION_CONFIDENCE_FLOOR,
  CANDIDATE_CONFIDENCE,
  type PromotableClaim,
} from "@/lib/intelligence/promote";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

const base: PromotableClaim = {
  id: "clm_1",
  text: "Ohio E-Check expands to 3 more counties in 2026.",
  category: "research_claim",
  status: "source_supported",
  confidence: 0.82,
  verificationScore: 0.9,
  bestMatchChunk: "matched chunk",
  documentId: "doc_1",
  sourceId: "src_1",
};

describe("isPromotable", () => {
  it("accepts a source-supported research_claim above the floor", () => {
    expect(isPromotable(base)).toBe(true);
  });

  it("rejects weak_support / unverified status", () => {
    expect(isPromotable({ ...base, status: "weak_support" })).toBe(false);
    expect(isPromotable({ ...base, status: "unverified" })).toBe(false);
  });

  it("rejects non-research_claim categories (questions/actions/contradictions)", () => {
    for (const category of ["research_question", "research_action", "research_contradiction"]) {
      expect(isPromotable({ ...base, category })).toBe(false);
    }
  });

  it("enforces the confidence floor (boundary inclusive)", () => {
    expect(isPromotable({ ...base, confidence: PROMOTION_CONFIDENCE_FLOOR - 0.01 })).toBe(false);
    expect(isPromotable({ ...base, confidence: PROMOTION_CONFIDENCE_FLOOR })).toBe(true);
  });

  it("rejects empty / whitespace-only text", () => {
    expect(isPromotable({ ...base, text: "   " })).toBe(false);
    expect(isPromotable({ ...base, text: "" })).toBe(false);
  });
});

describe("buildCandidateMemory", () => {
  const mem = buildCandidateMemory(base, "2026-07-22T00:00:00.000Z");

  it("lands in the QUARANTINED candidate category, never the trusted research_claim", () => {
    expect(mem.category).toBe(BRAIN_CATEGORIES.RESEARCH_CLAIM_CANDIDATE);
    expect(mem.category).not.toBe(BRAIN_CATEGORIES.RESEARCH_CLAIM);
  });

  it("uses a deterministic key so re-promotion upserts instead of duplicating", () => {
    expect(mem.key).toBe("intel_clm_1");
    expect(buildCandidateMemory(base, "2026-07-22T09:00:00.000Z").key).toBe(mem.key);
  });

  it("dampens confidence to a low-trust value below the claim's own", () => {
    expect(mem.confidence).toBe(CANDIDATE_CONFIDENCE);
    expect(mem.confidence).toBeLessThan(base.confidence);
  });

  it("carries full reversible provenance (claim -> document -> source)", () => {
    expect(mem.metadata).toMatchObject({
      claimId: "clm_1",
      documentId: "doc_1",
      sourceId: "src_1",
      originalConfidence: 0.82,
      verificationScore: 0.9,
      status: "source_supported",
      trust: "low",
      requiresHumanPromotion: true,
      promotedAt: "2026-07-22T00:00:00.000Z",
    });
  });

  it("preserves the (trimmed) claim text as content and tags provenance source", () => {
    expect(buildCandidateMemory({ ...base, text: "  spaced  " }, "t").content).toBe("spaced");
    expect(mem.source).toBe("intelligence-pipeline");
    expect(mem.createdBy).toBe("cron:intelligence-promote");
  });
});
