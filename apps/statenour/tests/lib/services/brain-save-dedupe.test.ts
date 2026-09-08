/**
 * tests/lib/services/brain-save-dedupe.test.ts · 2026-09-07
 *
 * THE LIVE DEFECT THIS PINS. `/save Rent is $1,900` embeds within cosine
 * 0.95 of an earlier `/save Rent is $1,800`, so saveToBrain took its
 * "duplicate" branch: it bumped the OLD row's sighting count, discarded the
 * new statement, and returned `Saved as …` with the OLD text. A correction
 * was silently thrown away and the confirmation said the opposite.
 *
 * The contract now (#2175 + its review round):
 *   · identity is deterministic and runs BEFORE any embedding call — an exact
 *     row, then a whitespace/case-insensitive match over recent rows;
 *   · similar-but-different text is saved as a NEW row, linked to the old one
 *     (metadata.nearDuplicateOf) and queued into the EXISTING contradiction
 *     review flow (same storage, same panel) — never merged automatically;
 *   · the embedding is optional enrichment — an outage still saves the text
 *     and reports `embedded: false`; embed-backfill indexes it later;
 *   · the outcome is reported truthfully so the chat confirmation matches.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

const mocks = vi.hoisted(() => ({
  brainMemory: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn(), upsert: vi.fn() },
  vectorEmbedding: { create: vi.fn(), findMany: vi.fn() },
  queryRawUnsafe: vi.fn(),
  executeRawUnsafe: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: mocks.brainMemory,
    vectorEmbedding: mocks.vectorEmbedding,
    $queryRawUnsafe: mocks.queryRawUnsafe,
    $executeRawUnsafe: mocks.executeRawUnsafe,
  },
}));
vi.mock("@/lib/ai/provider", () => ({ getEmbedding: vi.fn() }));
import { getEmbedding } from "@/lib/ai/provider";
const pgvector = vi.hoisted(() => ({ isPgvectorAvailable: vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/db/pgvector", () => ({
  isPgvectorAvailable: pgvector.isPgvectorAvailable,
  vectorLiteral: vi.fn((v: number[]) => `[${v.join(",")}]`),
  padToVectorDim: vi.fn((v: number[]) => v),
  assertSafeVectorLiteral: vi.fn(),
  VECTOR_DIM_1536: 1536,
}));

import { isSameStatement, saveToBrain } from "@/lib/services/brain/save";
import { buildContradictionKey } from "@/lib/brain/contradiction-surfacer";

const OLD_CREATED = new Date("2026-08-01T00:00:00Z");
const OLD = { id: "bm-old", key: "user_save_1", content: "Rent is $1,800 a month", created_at: OLD_CREATED, distance: 0.01 };

describe("isSameStatement", () => {
  it("ignores whitespace and case, nothing else", () => {
    expect(isSameStatement("Rent is $1,800", "  rent   is $1,800 ")).toBe(true);
    expect(isSameStatement("Rent is $1,800", "Rent is $1,900")).toBe(false);
    expect(isSameStatement("Call Mimi on Tuesday", "Call Gigi on Tuesday")).toBe(false);
    expect(isSameStatement("I will go", "I will not go")).toBe(false);
  });
});

describe("saveToBrain identity and near-duplicate semantics", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getEmbedding).mockResolvedValue([0.1, 0.2, 0.3]);
    pgvector.isPgvectorAvailable.mockResolvedValue(true);
    mocks.brainMemory.create.mockResolvedValue({ id: "bm-new" });
    mocks.brainMemory.update.mockResolvedValue({ seenCount: 3 });
    mocks.brainMemory.findMany.mockResolvedValue([]);
    mocks.brainMemory.findFirst.mockResolvedValue(null);
    mocks.brainMemory.upsert.mockResolvedValue({ id: "bm-review" });
    mocks.vectorEmbedding.create.mockResolvedValue({ id: "ve-new" });
    mocks.vectorEmbedding.findMany.mockResolvedValue([]);
    mocks.queryRawUnsafe.mockResolvedValue([]);
  });

  it("an exact row in the category is a duplicate BEFORE any embedding call", async () => {
    mocks.brainMemory.findFirst.mockResolvedValue({ id: "bm-old", key: "user_save_1", content: OLD.content, createdAt: OLD_CREATED });
    const r = await saveToBrain({ content: OLD.content });
    expect(r.outcome).toBe("duplicate");
    expect(r.id).toBe("bm-old");
    expect(r.summary).toBe("Already saved as user_save · Rent is $1,800 a month · seen 3×");
    expect(getEmbedding).not.toHaveBeenCalled();
    expect(mocks.brainMemory.create).not.toHaveBeenCalled();
  });

  it("a case/whitespace-shifted restatement in the recent rows is a duplicate even when embeddings are DOWN", async () => {
    vi.mocked(getEmbedding).mockRejectedValue(new Error("embedding provider offline"));
    mocks.brainMemory.findMany.mockResolvedValue([{ id: "bm-old", key: "user_save_1", content: OLD.content, createdAt: OLD_CREATED }]);
    const r = await saveToBrain({ content: "  rent IS $1,800 a month " });
    expect(r.outcome).toBe("duplicate");
    expect(r.relatedId).toBe("bm-old");
    expect(mocks.brainMemory.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "bm-old" }, data: expect.objectContaining({ seenCount: { increment: 1 } }) }),
    );
    expect(mocks.brainMemory.create).not.toHaveBeenCalled();
  });

  it("the identical statement found only by the vector search is still a duplicate", async () => {
    mocks.queryRawUnsafe.mockResolvedValue([OLD]);
    const r = await saveToBrain({ content: "rent is $1,800 a month" });
    expect(r.outcome).toBe("duplicate");
    expect(r.id).toBe("bm-old");
    expect(mocks.brainMemory.create).not.toHaveBeenCalled();
    expect(mocks.brainMemory.upsert).not.toHaveBeenCalled();
  });

  it("a changed amount is saved as a NEW row, linked to the similar one, and queued for review", async () => {
    mocks.queryRawUnsafe.mockResolvedValue([OLD]);
    const r = await saveToBrain({ content: "Rent is $1,900 a month", metadata: { via: "test" } });
    expect(r.outcome).toBe("created_near_duplicate");
    expect(r.id).toBe("bm-new");
    expect(r.relatedId).toBe("bm-old");
    expect(r.embedded).toBe(true);
    expect(r.reviewKey).toBe(buildContradictionKey("bm-new", "bm-old"));
    expect(r.summary).toBe(
      "Saved as user_save · Rent is $1,900 a month · similar memory kept: Rent is $1,800 a month · queued for review",
    );
    expect(mocks.brainMemory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ content: "Rent is $1,900 a month", metadata: { via: "test", nearDuplicateOf: "bm-old" } }),
      }),
    );
    // The old row is untouched: no sighting bump, no soft-delete, no supersession.
    expect(mocks.brainMemory.update).not.toHaveBeenCalled();
    // The pair went into the SAME contradiction storage the review panel reads.
    expect(mocks.brainMemory.upsert).toHaveBeenCalledTimes(1);
    const upsert = mocks.brainMemory.upsert.mock.calls[0][0];
    expect(upsert.where).toEqual({
      category_key: { category: BRAIN_CATEGORIES.CONTRADICTION, key: buildContradictionKey("bm-new", "bm-old") },
    });
    const stored = JSON.parse(upsert.create.content);
    expect(stored).toMatchObject({
      new_memory_id: "bm-new",
      old_memory_id: "bm-old",
      signal: "near_duplicate",
      status: "unresolved",
      new_excerpt: "Rent is $1,900 a month",
      old_excerpt: "Rent is $1,800 a month",
    });
    expect(stored.similarity).toBeCloseTo(0.99, 5);
    expect(stored.days_apart).toBeGreaterThan(0);
    expect(upsert.create.source).toBe("user_save_near_duplicate");
    // The new statement gets its own embedding so recall can find it.
    expect(mocks.vectorEmbedding.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sourceId: "bm-new", content: "Rent is $1,900 a month" }) }),
    );
  });

  it("a review-enqueue failure is loud in the summary but never loses the save", async () => {
    mocks.queryRawUnsafe.mockResolvedValue([OLD]);
    mocks.brainMemory.upsert.mockRejectedValue(new Error("contradiction storage down"));
    const r = await saveToBrain({ content: "Rent is $1,900 a month" });
    expect(r.outcome).toBe("created_near_duplicate");
    expect(r.reviewKey).toBeUndefined();
    expect(r.summary).toContain("review enqueue failed");
    expect(mocks.brainMemory.create).toHaveBeenCalledTimes(1);
  });

  it("no similar row at all: plain create, plain summary, no link, no review row", async () => {
    const r = await saveToBrain({ content: "Rent is $1,900 a month" });
    expect(r.outcome).toBe("created");
    expect(r.relatedId).toBeUndefined();
    expect(r.reviewKey).toBeUndefined();
    expect(r.embedded).toBe(true);
    expect(r.summary).toBe("Saved as user_save · Rent is $1,900 a month");
    expect(mocks.brainMemory.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ metadata: null }) }),
    );
    expect(mocks.brainMemory.upsert).not.toHaveBeenCalled();
  });

  it("an embedding outage still saves NEW text and says the index is pending", async () => {
    vi.mocked(getEmbedding).mockRejectedValue(new Error("embedding provider offline"));
    const r = await saveToBrain({ content: "Rent is $1,900 a month" });
    expect(r.outcome).toBe("created");
    expect(r.embedded).toBe(false);
    expect(r.summary).toBe("Saved as user_save · Rent is $1,900 a month · search index pending");
    expect(mocks.brainMemory.create).toHaveBeenCalledTimes(1);
    expect(mocks.vectorEmbedding.create).not.toHaveBeenCalled();
    expect(mocks.queryRawUnsafe).not.toHaveBeenCalled();
  });

  it("the JS cosine fallback obeys the same rule when pgvector is off", async () => {
    pgvector.isPgvectorAvailable.mockResolvedValue(false);
    mocks.brainMemory.findMany.mockResolvedValue([{ id: "bm-old", key: "user_save_1", content: OLD.content, createdAt: OLD_CREATED }]);
    // identical direction → cosine 1.0 > 0.95
    mocks.vectorEmbedding.findMany.mockResolvedValue([{ sourceId: "bm-old", embedding: JSON.stringify([0.1, 0.2, 0.3]) }]);
    const r = await saveToBrain({ content: "Rent is $1,900 a month" });
    expect(r.outcome).toBe("created_near_duplicate");
    expect(r.relatedId).toBe("bm-old");
    expect(r.reviewKey).toBe(buildContradictionKey("bm-new", "bm-old"));
    expect(mocks.brainMemory.update).not.toHaveBeenCalled();
  });
});
