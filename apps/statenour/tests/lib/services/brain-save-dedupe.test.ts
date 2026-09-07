/**
 * tests/lib/services/brain-save-dedupe.test.ts · 2026-09-07
 *
 * THE LIVE DEFECT THIS PINS. `/save Rent is $1,900` embeds within cosine
 * 0.95 of an earlier `/save Rent is $1,800`, so saveToBrain took its
 * "duplicate" branch: it bumped the OLD row's sighting count, discarded the
 * new statement, and returned `Saved as …` with the OLD text. A correction
 * was silently thrown away and the confirmation said the opposite.
 *
 * Now: only a whitespace/case-insensitive identical statement is a
 * duplicate. Similar-but-different text is saved as a NEW row, linked to
 * the old one (metadata.nearDuplicateOf) for the review surface, and the
 * outcome is reported truthfully so the chat confirmation can match it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  brainMemory: { create: vi.fn(), findMany: vi.fn(), update: vi.fn() },
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

const OLD = { id: "bm-old", key: "user_save_1", content: "Rent is $1,800 a month", distance: 0.01 };

describe("isSameStatement", () => {
  it("ignores whitespace and case, nothing else", () => {
    expect(isSameStatement("Rent is $1,800", "  rent   is $1,800 ")).toBe(true);
    expect(isSameStatement("Rent is $1,800", "Rent is $1,900")).toBe(false);
    expect(isSameStatement("Call Mimi on Tuesday", "Call Gigi on Tuesday")).toBe(false);
    expect(isSameStatement("I will go", "I will not go")).toBe(false);
  });
});

describe("saveToBrain near-duplicate semantics", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getEmbedding).mockResolvedValue([0.1, 0.2, 0.3]);
    pgvector.isPgvectorAvailable.mockResolvedValue(true);
    mocks.brainMemory.create.mockResolvedValue({ id: "bm-new" });
    mocks.brainMemory.update.mockResolvedValue({ seenCount: 3 });
    mocks.brainMemory.findMany.mockResolvedValue([]);
    mocks.vectorEmbedding.create.mockResolvedValue({ id: "ve-new" });
    mocks.vectorEmbedding.findMany.mockResolvedValue([]);
    mocks.queryRawUnsafe.mockResolvedValue([]);
  });

  it("the identical statement bumps the sighting count and says 'Already saved'", async () => {
    mocks.queryRawUnsafe.mockResolvedValue([OLD]);
    const r = await saveToBrain({ content: "rent is $1,800 a month" });
    expect(r.outcome).toBe("duplicate");
    expect(r.id).toBe("bm-old");
    expect(r.relatedId).toBe("bm-old");
    expect(r.summary).toMatch(/^Already saved as user_save · Rent is \$1,800 a month · seen 3×$/);
    expect(mocks.brainMemory.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "bm-old" }, data: expect.objectContaining({ seenCount: { increment: 1 } }) }),
    );
    expect(mocks.brainMemory.create).not.toHaveBeenCalled();
  });

  it("a changed amount is saved as a NEW row, linked to the similar one, and both are kept", async () => {
    mocks.queryRawUnsafe.mockResolvedValue([OLD]);
    const r = await saveToBrain({ content: "Rent is $1,900 a month", metadata: { via: "test" } });
    expect(r.outcome).toBe("created_near_duplicate");
    expect(r.id).toBe("bm-new");
    expect(r.relatedId).toBe("bm-old");
    expect(r.summary).toBe("Saved as user_save · Rent is $1,900 a month · similar memory kept: Rent is $1,800 a month");
    expect(mocks.brainMemory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: "Rent is $1,900 a month",
          metadata: { via: "test", nearDuplicateOf: "bm-old" },
        }),
      }),
    );
    // The old row is untouched: no sighting bump, no soft-delete, no rewrite.
    expect(mocks.brainMemory.update).not.toHaveBeenCalled();
    // The new statement gets its own embedding so recall can find it.
    expect(mocks.vectorEmbedding.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ sourceId: "bm-new", content: "Rent is $1,900 a month" }) }),
    );
  });

  it("no similar row at all: plain create, plain summary, no link", async () => {
    const r = await saveToBrain({ content: "Rent is $1,900 a month" });
    expect(r.outcome).toBe("created");
    expect(r.relatedId).toBeUndefined();
    expect(r.summary).toBe("Saved as user_save · Rent is $1,900 a month");
    expect(mocks.brainMemory.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ metadata: null }) }),
    );
  });

  it("the JS cosine fallback obeys the same rule when pgvector is off", async () => {
    pgvector.isPgvectorAvailable.mockResolvedValue(false);
    mocks.brainMemory.findMany.mockResolvedValue([{ id: "bm-old", key: "user_save_1", content: OLD.content }]);
    // identical direction → cosine 1.0 > 0.95
    mocks.vectorEmbedding.findMany.mockResolvedValue([{ sourceId: "bm-old", embedding: JSON.stringify([0.1, 0.2, 0.3]) }]);
    const r = await saveToBrain({ content: "Rent is $1,900 a month" });
    expect(r.outcome).toBe("created_near_duplicate");
    expect(r.relatedId).toBe("bm-old");
    expect(mocks.brainMemory.update).not.toHaveBeenCalled();
  });
});
