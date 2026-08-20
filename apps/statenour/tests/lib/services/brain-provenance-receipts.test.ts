/**
 * Provenance receipt-first contract (2026-08-19 · memory-loop wave).
 *
 * "Why did Nick say this?" used to RE-RUN recall against the reply text
 * at read time and present the reconstruction as the answer — it could
 * differ from what the model actually saw, and it bumped lastSeen as a
 * side effect. Now the turn persists its recall receipts into
 * tokenUsage.recall, and the provenance service answers from those,
 * labeled `origin: "receipt"`; the re-recall survives only as the
 * labeled fallback for pre-receipt messages.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  chatMessage: { findUnique: vi.fn(), findFirst: vi.fn() },
  brainMemory: { findMany: vi.fn(), findFirst: vi.fn() },
  recallMemoriesForQuery: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { chatMessage: mocks.chatMessage, brainMemory: mocks.brainMemory },
}));
vi.mock("@/lib/brain/memory-recall", () => ({
  recallMemoriesForQuery: mocks.recallMemoriesForQuery,
}));

import { readMessageProvenance } from "@/lib/services/brain-provenance";

const RECEIPT = {
  id: "bm-r1",
  category: "task_lesson",
  key: "task_lesson:t1",
  similarity: 0.82,
  seenCount: 3,
  snippet: "Should have confirmed stock first.",
};

function message(tokenUsage: unknown) {
  return {
    id: "m1",
    role: "assistant",
    content: "Here is why...",
    createdAt: new Date("2026-08-19T12:00:00Z"),
    conversationId: "c1",
    tokenUsage,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.chatMessage.findFirst.mockResolvedValue(null); // prior user turn
  mocks.brainMemory.findFirst.mockResolvedValue(null); // judge/objection
  mocks.brainMemory.findMany.mockResolvedValue([]);
  mocks.recallMemoriesForQuery.mockResolvedValue({
    hits: [],
    scanned: 0,
    durationMs: 1,
  });
});

describe("readMessageProvenance · receipt-first", () => {
  it("answers from persisted receipts WITHOUT re-running recall", async () => {
    mocks.chatMessage.findUnique.mockResolvedValue(message({ recall: [RECEIPT] }));
    mocks.brainMemory.findMany.mockResolvedValue([
      {
        id: "bm-r1",
        category: "task_lesson",
        key: "task_lesson:t1",
        content: "Should have confirmed stock before promising a date.",
        confidence: 0.85,
        seenCount: 4,
        createdAt: new Date("2026-08-01T00:00:00Z"),
      },
    ]);

    const res = await readMessageProvenance({ messageId: "m1" });

    expect(res.recall.origin).toBe("receipt");
    expect(mocks.recallMemoriesForQuery).not.toHaveBeenCalled();
    expect(res.recall.hits).toHaveLength(1);
    // Live row supplies fresh content; the receipt supplies the
    // turn-time similarity and seenCount.
    expect(res.recall.hits[0].content).toContain("promising a date");
    expect(res.recall.hits[0].seenCount).toBe(3);
    expect(res.recall.hits[0].finalScore).toBeCloseTo(0.82);
  });

  it("a receipt OUTLIVES its row — deleted/merged memories fall back to the snippet", async () => {
    mocks.chatMessage.findUnique.mockResolvedValue(message({ recall: [RECEIPT] }));
    mocks.brainMemory.findMany.mockResolvedValue([]); // row since ground/deleted

    const res = await readMessageProvenance({ messageId: "m1" });

    expect(res.recall.origin).toBe("receipt");
    expect(res.recall.hits[0].content).toContain("Should have confirmed stock first.");
    expect(res.recall.hits[0].content).toContain("no longer live");
    // Review 2026-08-20: SOFT-deleted rows must take this fallback too —
    // the hydration query filters deletedAt, so a forgotten memory never
    // renders as live.
    expect(mocks.brainMemory.findMany.mock.calls[0][0].where.deletedAt).toBeNull();
  });

  it("pre-receipt messages fall back to re-recall, labeled reconstruction", async () => {
    mocks.chatMessage.findUnique.mockResolvedValue(message({ traceId: "t" }));
    mocks.recallMemoriesForQuery.mockResolvedValue({
      hits: [
        {
          memoryId: "bm-x",
          category: "wisdom",
          key: "w1",
          content: "old wisdom",
          confidence: 0.7,
          seenCount: 2,
          ageDays: 10,
          knnDistance: 0.3,
          finalScore: 0.7,
        },
      ],
      scanned: 15,
      durationMs: 12,
    });

    const res = await readMessageProvenance({ messageId: "m1" });

    expect(res.recall.origin).toBe("reconstruction");
    expect(mocks.recallMemoriesForQuery).toHaveBeenCalledTimes(1);
    expect(res.recall.hits[0].content).toBe("old wisdom");
  });

  it("an EMPTY receipts array is not a receipt — falls back to reconstruction", async () => {
    // A turn that ran with recall disabled persists nothing; an empty
    // array must not be presented as "nothing fired, guaranteed".
    mocks.chatMessage.findUnique.mockResolvedValue(message({ recall: [] }));
    await readMessageProvenance({ messageId: "m1" });
    expect(mocks.recallMemoriesForQuery).toHaveBeenCalledTimes(1);
  });
});
