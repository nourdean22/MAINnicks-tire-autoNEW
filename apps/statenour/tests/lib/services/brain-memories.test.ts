import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recall: vi.fn(),
  findFirst: vi.fn(),
  forget: vi.fn(),
}));

vi.mock("@/lib/brain/memory-manager", () => ({
  brainMemory: {
    recall: mocks.recall,
    remember: vi.fn(),
    forget: mocks.forget,
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      findFirst: mocks.findFirst,
    },
  },
}));

import { listMemories } from "@/lib/services/brain-memories";

const timestamp = new Date("2026-07-11T12:00:00.000Z");

function row(id: string, metadata: Record<string, unknown>, confidence: number) {
  return {
    id,
    category: "research_pack",
    key: id,
    content: id,
    confidence,
    source: "test",
    seenCount: 1,
    metadata,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastSeen: timestamp,
    expiresAt: null,
  };
}

describe("ordinary brain-memory lists", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("excludes governed staging rows even when confidence zero is requested", async () => {
    mocks.recall.mockResolvedValue([
      row("candidate", { recordType: "knowledge_candidate" }, 0),
      row("normal", {}, 0.8),
    ]);

    const result = await listMemories({ minConfidence: 0, limit: 10 });

    expect(mocks.recall).toHaveBeenCalledWith(undefined, {
      query: undefined,
      minConfidence: 0.001,
      limit: 20,
    });
    expect(result.memories.map((memory) => memory.id)).toEqual(["normal"]);
  });
});
