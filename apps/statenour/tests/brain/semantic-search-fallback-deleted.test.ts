/**
 * The in-memory FALLBACK path must honour the same guards as pgvector.
 *
 * semanticSearch falls through to a JSON-cosine scan when pgvector is
 * unavailable or every knnSearch call fails. tests/brain/semantic-search-deleted
 * and -quarantine both mock pgvector as AVAILABLE, so they never reach this
 * branch — which is how it kept serving soft-deleted and quarantined content
 * after the fast path was hardened.
 *
 * The exposure is worse than it looks: this branch runs precisely during a
 * pgvector outage, so deleted content became recallable exactly when the system
 * was already degraded.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const LIVE = "mem_live";
const DELETED = "mem_deleted";
const GONE = "mem_gone";
const vec = JSON.stringify(new Array(8).fill(0.1));

// pgvector OFF — this is the whole point of the file.
vi.mock("@/lib/db/pgvector", () => ({
  isPgvectorAvailable: vi.fn(async () => false),
  knnSearch: vi.fn(async () => null),
  assertSafeVectorLiteral: vi.fn(),
  padToVectorDim: (v: number[]) => v,
  vectorLiteral: (v: number[]) => `[${v.join(",")}]`,
}));

const brainFindMany = vi.fn(async (args: { where?: Record<string, unknown> }) => {
  // Stand in for the DB: honour deletedAt/category filters if the code sends
  // them, return everything if it does not. That asymmetry is what makes this
  // test fail when the guard is missing.
  const filtered = Boolean(args?.where && "deletedAt" in args.where);
  return filtered
    ? [{ id: LIVE, confidence: 0.9, createdAt: new Date(), category: "insight", seenCount: 1 }]
    : [
        { id: LIVE, confidence: 0.9, createdAt: new Date(), category: "insight", seenCount: 1 },
        { id: DELETED, confidence: 0.9, createdAt: new Date(), category: "insight", seenCount: 1 },
      ];
});

vi.mock("@/lib/prisma", () => ({
  prisma: {
    vectorEmbedding: {
      findMany: vi.fn(async () => [
        { sourceId: DELETED, sourceType: "brain_memory", content: "SECRET deleted content", embedding: vec },
        { sourceId: GONE, sourceType: "brain_memory", content: "orphaned content", embedding: vec },
        { sourceId: LIVE, sourceType: "brain_memory", content: "live content", embedding: vec },
      ]),
    },
    brainMemory: { findMany: (a: never) => brainFindMany(a) },
  },
}));

vi.mock("@/lib/ai/provider", () => ({
  getEmbedding: vi.fn(async () => new Array(8).fill(0.1)),
}));

describe("semanticSearch · in-memory fallback (pgvector unavailable)", () => {
  beforeEach(() => {
    vi.resetModules();
    brainFindMany.mockClear();
  });
  afterEach(() => vi.restoreAllMocks());

  it("filters deletedAt in the fallback metadata query", async () => {
    const { semanticSearch } = await import("@/lib/brain/embedding-utils");
    await semanticSearch("anything", 10, ["brain_memory"]);

    expect(brainFindMany).toHaveBeenCalled();
    const where = (brainFindMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where.deletedAt, "fallback must exclude soft-deleted memories").toBeNull();
    expect(where.category, "fallback must honour the recall quarantine").toBeDefined();
  });

  it("does not return soft-deleted or orphaned content from the fallback", async () => {
    const { semanticSearch } = await import("@/lib/brain/embedding-utils");
    const hits = await semanticSearch("anything", 10, ["brain_memory"]);
    const ids = hits.map((h) => h.sourceId);

    expect(ids).not.toContain(DELETED);
    expect(ids).not.toContain(GONE);
    expect(hits.map((h) => h.content).join(" ")).not.toContain("SECRET deleted content");
  });

  it("still returns the live memory, so the guard is not just filtering everything", async () => {
    const { semanticSearch } = await import("@/lib/brain/embedding-utils");
    const hits = await semanticSearch("anything", 10, ["brain_memory"]);
    expect(hits.map((h) => h.sourceId)).toContain(LIVE);
  });
});
