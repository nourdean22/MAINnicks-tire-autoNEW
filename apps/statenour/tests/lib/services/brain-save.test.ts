/**
 * /save → brain ingest · May 02 · v10.0.143
 *
 * User-triggered ingest with heuristic auto-categorization. Tests
 * cover both pure categorization (no DB) and the saveToBrain write
 * path with prisma mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  brainMemory: {
    create: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
  },
  vectorEmbedding: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
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

// Mock getEmbedding
import { getEmbedding } from "@/lib/ai/provider";
vi.mock("@/lib/ai/provider", () => ({
  getEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
}));

// Mock pgvector
const pgvectorMock = vi.hoisted(() => ({
  isPgvectorAvailable: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/db/pgvector", () => ({
  isPgvectorAvailable: pgvectorMock.isPgvectorAvailable,
  vectorLiteral: vi.fn((v) => `[${v.join(",")}]`),
  padToVectorDim: vi.fn((v) => v),
  assertSafeVectorLiteral: vi.fn(),
  VECTOR_DIM_1536: 1536,
}));

import { categorizeForSave, saveToBrain } from "@/lib/services/brain/save";

describe("categorizeForSave", () => {
  it("decision keywords route to 'decision'", () => {
    expect(categorizeForSave("I decided to move the rebrand to Q3")).toBe("decision");
    expect(categorizeForSave("decision: pause the email campaign")).toBe("decision");
    expect(categorizeForSave("going with the gold and black palette")).toBe("decision");
  });

  it("belief keywords route to 'belief'", () => {
    expect(categorizeForSave("I believe trust beats discount in this market")).toBe("belief");
    expect(categorizeForSave("My view is that long-form converts better")).toBe("belief");
  });

  it("strategy keywords route to 'strategy'", () => {
    expect(categorizeForSave("The strategy is to dominate Cleveland local search first")).toBe("strategy");
    expect(categorizeForSave("New playbook for inbound calls")).toBe("strategy");
  });

  it("brand/marketing keywords route to 'brand_marketing'", () => {
    expect(categorizeForSave("Our brand voice should feel like a senior mechanic")).toBe("brand_marketing");
    expect(categorizeForSave("Write captions in plain language, no jargon")).toBe("brand_marketing");
    expect(categorizeForSave("Instagram engagement spikes on educational reels")).toBe("brand_marketing");
  });

  it("pattern keywords route to 'pattern'", () => {
    expect(categorizeForSave("Pattern: every Friday afternoon discipline drops")).toBe("pattern");
    expect(categorizeForSave("Always batch oil changes on Mondays")).toBe("pattern");
  });

  it("falls back to 'user_save' when nothing matches", () => {
    expect(categorizeForSave("just a random thought about the weather")).toBe("user_save");
  });

  it("category precedence — decision wins over brand", () => {
    // A sentence that mentions both decision + brand keywords should
    // resolve to "decision" because it's checked first (the user
    // explicitly committed to something).
    expect(
      categorizeForSave("I decided the brand voice will stay direct and educational"),
    ).toBe("decision");
  });
});

describe("saveToBrain", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.brainMemory.create.mockResolvedValue({ id: "bm-123" });
    mocks.brainMemory.findMany.mockResolvedValue([]);
    mocks.brainMemory.update.mockResolvedValue({ id: "bm-123" });
    mocks.vectorEmbedding.create.mockResolvedValue({ id: "ve-123" });
    mocks.vectorEmbedding.findMany.mockResolvedValue([]);
    mocks.queryRawUnsafe.mockResolvedValue([]);
    pgvectorMock.isPgvectorAvailable.mockResolvedValue(true);
    vi.mocked(getEmbedding).mockResolvedValue([0.1, 0.2, 0.3]);
  });

  it("writes a BrainMemory row with auto-categorized category and writes embedding", async () => {
    const result = await saveToBrain({
      content: "I decided to launch the Cleveland tire promotion in May",
    });
    expect(result.id).toBe("bm-123");
    expect(result.category).toBe("decision");
    expect(result.key).toMatch(/^decision_\d+$/);
    expect(mocks.brainMemory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          category: "decision",
          source: "user_save",
        }),
      }),
    );
    expect(mocks.vectorEmbedding.create).toHaveBeenCalled();
    expect(mocks.executeRawUnsafe).toHaveBeenCalled();
  });

  it("detects duplicates using pgvector and updates seenCount", async () => {
    mocks.queryRawUnsafe.mockResolvedValue([
      { id: "bm-existing", key: "decision_existing", content: "Existing decision content", distance: 0.02 }
    ]);

    const result = await saveToBrain({
      content: "I decided to launch the Cleveland tire promotion in May",
    });

    expect(result.id).toBe("bm-existing");
    expect(result.key).toBe("decision_existing");
    expect(result.summary).toContain("Existing decision content");
    expect(mocks.brainMemory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "bm-existing" },
        data: expect.objectContaining({
          seenCount: { increment: 1 },
        }),
      }),
    );
    expect(mocks.brainMemory.create).not.toHaveBeenCalled();
  });

  it("falls back to JS cosine similarity when pgvector is unavailable", async () => {
    pgvectorMock.isPgvectorAvailable.mockResolvedValue(false);
    mocks.brainMemory.findMany.mockResolvedValue([
      { id: "bm-similar", key: "decision_similar", content: "A very similar decision" }
    ]);
    mocks.vectorEmbedding.findMany.mockResolvedValue([
      { sourceId: "bm-similar", embedding: JSON.stringify([0.1, 0.2, 0.3]) }
    ]);

    const result = await saveToBrain({
      content: "A very similar decision",
    });

    expect(result.id).toBe("bm-similar");
    expect(result.key).toBe("decision_similar");
    expect(mocks.brainMemory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "bm-similar" },
        data: expect.objectContaining({
          seenCount: { increment: 1 },
        }),
      }),
    );
    expect(mocks.brainMemory.create).not.toHaveBeenCalled();
  });

  it("respects an explicit category override", async () => {
    const result = await saveToBrain({
      content: "anything at all",
      category: "belief",
    });
    expect(result.category).toBe("belief");
    expect(mocks.brainMemory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ category: "belief" }),
      }),
    );
  });

  it("rejects content shorter than 3 chars", async () => {
    await expect(saveToBrain({ content: "ok" })).rejects.toThrow(/too short/i);
    expect(mocks.brainMemory.create).not.toHaveBeenCalled();
  });

  it("includes a slug in the key when keyHint is provided", async () => {
    const result = await saveToBrain({
      content: "marketing strategy thought",
      keyHint: "Q3 launch plan",
    });
    expect(result.key).toMatch(/^strategy_q3-launch-plan_\d+$/);
  });

  it("returns a confirmation summary truncated at 120 chars", async () => {
    const long = "a".repeat(300);
    const result = await saveToBrain({ content: long });
    expect(result.summary).toContain("Saved as user_save");
    expect(result.summary).toMatch(/…$/);
  });

  it("creates a new memory even when embedding retrieval fails", async () => {
    vi.mocked(getEmbedding).mockRejectedValueOnce(new Error("Embedding API offline"));

    const result = await saveToBrain({
      content: "I decided to launch the Cleveland tire promotion in May",
    });

    expect(result.id).toBe("bm-123");
    expect(result.category).toBe("decision");
    expect(mocks.brainMemory.create).toHaveBeenCalled();
    expect(mocks.vectorEmbedding.create).not.toHaveBeenCalled();
  });

  it("falls back to JS cosine similarity when pgvector query throws an error", async () => {
    mocks.queryRawUnsafe.mockRejectedValueOnce(new Error("pgvector database connection timeout"));
    mocks.brainMemory.findMany.mockResolvedValue([
      { id: "bm-fallback", key: "decision_fallback", content: "Fallback decision content" }
    ]);
    mocks.vectorEmbedding.findMany.mockResolvedValue([
      { sourceId: "bm-fallback", embedding: JSON.stringify([0.1, 0.2, 0.3]) }
    ]);

    const result = await saveToBrain({
      content: "I decided to launch the Cleveland tire promotion in May",
    });

    expect(result.id).toBe("bm-fallback");
    expect(result.key).toBe("decision_fallback");
    expect(mocks.brainMemory.update).toHaveBeenCalled();
    expect(mocks.brainMemory.create).not.toHaveBeenCalled();
  });

  it("skips malformed JSON embeddings during JS cosine similarity fallback", async () => {
    pgvectorMock.isPgvectorAvailable.mockResolvedValue(false);
    mocks.brainMemory.findMany.mockResolvedValue([
      { id: "bm-malformed", key: "decision_malformed", content: "Malformed embedding content" },
      { id: "bm-good", key: "decision_good", content: "Good embedding content" }
    ]);
    mocks.vectorEmbedding.findMany.mockResolvedValue([
      { sourceId: "bm-malformed", embedding: "{invalid-json}" },
      { sourceId: "bm-good", embedding: JSON.stringify([0.1, 0.2, 0.3]) }
    ]);

    const result = await saveToBrain({
      content: "Good embedding content",
    });

    expect(result.id).toBe("bm-good");
    expect(result.key).toBe("decision_good");
    expect(mocks.brainMemory.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "bm-good" },
      })
    );
  });

  it("does not deduplicate when there is a category mismatch", async () => {
    pgvectorMock.isPgvectorAvailable.mockResolvedValue(false);
    mocks.brainMemory.findMany.mockResolvedValue([]); // Category decision has no records
    
    const result = await saveToBrain({
      content: "I decided to launch the Cleveland tire promotion in May",
      category: "decision",
    });

    expect(result.id).toBe("bm-123");
    expect(mocks.brainMemory.create).toHaveBeenCalled();
    expect(mocks.brainMemory.update).not.toHaveBeenCalled();
  });
});

