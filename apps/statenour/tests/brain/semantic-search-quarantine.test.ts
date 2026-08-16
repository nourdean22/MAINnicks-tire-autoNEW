/**
 * RECALL_EXCLUDE_CATEGORIES must be enforced at the VECTOR boundary.
 *
 * tests/brain/recall-quarantine.test.ts pins the exclusion LIST. That test stays
 * green while any path ignores the list — which is exactly what happened: the
 * quarantine was only honoured by callers that hand-wrote
 * `category: { notIn: [...] }` into a Prisma where-clause, and semanticSearch
 * filtered on sourceType alone. So `research_claim_candidate` rows, minted at
 * confidence 0.3 and awaiting human promotion, were reachable through the vector
 * path by all twelve semanticSearch callers.
 *
 * Two of those callers make it an epistemic problem rather than a tidiness one:
 *   · lib/intelligence/grounding.ts   — groundClaim() takes matches[0] with no
 *     category check, so an un-promoted candidate could return
 *     status "source_supported": one unverified external claim corroborating
 *     another, with that status interpolated into an LLM prompt.
 *   · lib/brain/contradiction-surfacer.ts — same exposure for neighbours.
 *
 * This pins the boundary: semanticSearch must HAND the exclusion list to
 * knnSearch, so the filter applies before the LIMIT rather than after.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BRAIN_CATEGORIES, RECALL_EXCLUDE_CATEGORIES } from "@/lib/brain/categories";

const knnSearchMock = vi.fn(async () => [
  { sourceType: "brain_memory", sourceId: "m1", content: "live content", distance: 0.05 },
]);

vi.mock("@/lib/db/pgvector", () => ({
  isPgvectorAvailable: vi.fn(async () => true),
  knnSearch: (...args: unknown[]) => knnSearchMock(...(args as [])),
  assertSafeVectorLiteral: vi.fn(),
  padToVectorDim: (v: number[]) => v,
  vectorLiteral: (v: number[]) => `[${v.join(",")}]`,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      findMany: vi.fn(async () => [
        { id: "m1", confidence: 0.9, createdAt: new Date(), category: "insight", seenCount: 1 },
      ]),
    },
  },
}));

vi.mock("@/lib/ai/provider", () => ({
  getEmbedding: vi.fn(async () => new Array(1024).fill(0.01)),
}));

describe("semanticSearch · recall quarantine reaches the vector path", () => {
  beforeEach(() => {
    vi.resetModules();
    knnSearchMock.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("hands RECALL_EXCLUDE_CATEGORIES to knnSearch so the filter precedes the LIMIT", async () => {
    const { semanticSearch } = await import("@/lib/brain/embedding-utils");
    await semanticSearch("anything", 8, ["brain_memory"]);

    expect(knnSearchMock).toHaveBeenCalled();
    const opts = (knnSearchMock.mock.calls[0] as unknown[])[1] as {
      excludeCategories?: readonly string[];
    };
    expect(opts?.excludeCategories, "semanticSearch must pass the quarantine list").toBeDefined();
    expect([...(opts.excludeCategories ?? [])]).toEqual([...RECALL_EXCLUDE_CATEGORIES]);
  });

  it("specifically quarantines un-promoted research claim candidates", async () => {
    const { semanticSearch } = await import("@/lib/brain/embedding-utils");
    await semanticSearch("anything", 8, ["brain_memory"]);

    const opts = (knnSearchMock.mock.calls[0] as unknown[])[1] as {
      excludeCategories?: readonly string[];
    };
    expect(opts.excludeCategories).toContain(BRAIN_CATEGORIES.RESEARCH_CLAIM_CANDIDATE);
  });

  it("applies the same list to every source type it fans out over", async () => {
    const { semanticSearch } = await import("@/lib/brain/embedding-utils");
    await semanticSearch("anything", 8, ["brain_memory", "chat_message"]);

    expect(knnSearchMock.mock.calls.length).toBeGreaterThan(1);
    for (const call of knnSearchMock.mock.calls) {
      const o = (call as unknown[])[1] as { excludeCategories?: readonly string[] };
      expect(o?.excludeCategories).toBeDefined();
    }
  });
});
