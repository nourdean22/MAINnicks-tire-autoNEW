import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  detect: vi.fn(),
  surface: vi.fn(),
  overlap: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { brainMemory: { findMany: mocks.findMany } },
}));
vi.mock("@/lib/brain/contradiction-surfacer", () => ({
  detectContradictionSignal: mocks.detect,
  surfaceContradictionPair: mocks.surface,
}));
vi.mock("@/lib/brain/memory-commit-gateway", () => ({
  nearDuplicateScore: mocks.overlap,
}));

import { shadowAdmissionContradictions } from "@/lib/brain/memory-contradiction-shadow";

describe("Q-31 admission contradiction shadow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findMany.mockResolvedValue([]);
    mocks.detect.mockReturnValue(null);
    mocks.overlap.mockReturnValue(0);
    mocks.surface.mockResolvedValue("row-key");
  });

  it("constrains candidates by category and the indexed newest-25 window", async () => {
    await shadowAdmissionContradictions({
      memoryId: "new-1",
      category: "preference",
      content: "I prefer appointments on Tuesdays",
    });

    expect(mocks.findMany).toHaveBeenCalledWith({
      where: {
        category: "preference",
        id: { not: "new-1" },
        deletedAt: null,
        supersededById: null,
      },
      orderBy: { updatedAt: "desc" },
      take: 25,
      select: { id: true, content: true, createdAt: true },
    });
  });

  it("requires both a contradiction signal and material topic overlap", async () => {
    mocks.findMany.mockResolvedValue([
      { id: "old-1", content: "I prefer appointments on Tuesdays", createdAt: new Date("2026-09-01") },
      { id: "old-2", content: "I never want appointments on Tuesdays", createdAt: new Date("2026-09-02") },
    ]);

    mocks.detect
      .mockReturnValueOnce("negation")
      .mockReturnValueOnce("negation");
    mocks.overlap
      .mockReturnValueOnce(0.2)
      .mockReturnValueOnce(0.72);

    const result = await shadowAdmissionContradictions({
      memoryId: "new-1",
      category: "preference",
      content: "Actually I want appointments on Tuesdays",
    });

    expect(result).toEqual({ scanned: 2, flagged: 1 });
    expect(mocks.surface).toHaveBeenCalledTimes(1);
    expect(mocks.surface).toHaveBeenCalledWith(expect.objectContaining({
      newMemoryId: "new-1",
      oldMemoryId: "old-2",
      shadow: true,
      detector: "admission_index_constrained_v1",
      signal: "negation",
      similarity: 0.72,
    }));
  });

  it("caps one accepted write at three shadow pairs", async () => {
    mocks.findMany.mockResolvedValue(
      Array.from({ length: 8 }, (_, i) => ({
        id: `old-${i}`,
        content: `old claim ${i}`,
        createdAt: new Date("2026-09-01"),
      })),
    );
    mocks.detect.mockReturnValue("reversal");
    mocks.overlap.mockReturnValue(0.8);

    const result = await shadowAdmissionContradictions({
      memoryId: "new-1",
      category: "insight",
      content: "actually old claim should reverse",
    });

    expect(result.flagged).toBe(3);
    expect(mocks.surface).toHaveBeenCalledTimes(3);
  });

  it("never recursively scans contradiction/shadow bookkeeping categories", async () => {
    for (const category of ["contradiction", "superseded_snapshot", "memory_gateway_shadow"]) {
      await expect(
        shadowAdmissionContradictions({
          memoryId: "m",
          category,
          content: "some sufficiently long content",
        }),
      ).resolves.toEqual({ scanned: 0, flagged: 0 });
    }
    expect(mocks.findMany).not.toHaveBeenCalled();
  });
});
