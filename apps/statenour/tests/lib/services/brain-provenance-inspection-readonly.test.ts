/**
 * Inspecting provenance must not write (audit 2026-10-10, 05-M17).
 *
 * "Why did Nick say this?" on a pre-receipt message falls back to re-running
 * recall. With default options that recall bumps lastSeen and writes a
 * SystemMetric row — opening the inspector changed the memories it inspected
 * (lastSeen feeds the recency boost). The fallback must ask for a read-only
 * recall.
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.chatMessage.findUnique.mockResolvedValue({
    id: "m1",
    role: "assistant",
    content: "Here is why...",
    createdAt: new Date("2026-08-19T12:00:00Z"),
    conversationId: "c1",
    tokenUsage: { traceId: "t" }, // pre-receipt: no recall receipts persisted
  });
  mocks.chatMessage.findFirst.mockResolvedValue(null);
  mocks.brainMemory.findFirst.mockResolvedValue(null);
  mocks.brainMemory.findMany.mockResolvedValue([]);
  mocks.recallMemoriesForQuery.mockResolvedValue({ hits: [], scanned: 0, durationMs: 1 });
});

describe("readMessageProvenance · reconstruction fallback is read-only", () => {
  it("re-runs recall with sideEffects:false", async () => {
    const res = await readMessageProvenance({ messageId: "m1" });

    // POSITIVE CONTROL: the fallback path was taken.
    expect(res.recall.origin).toBe("reconstruction");
    expect(mocks.recallMemoriesForQuery).toHaveBeenCalledWith(
      "Here is why...",
      expect.objectContaining({ sideEffects: false }),
    );
  });
});
