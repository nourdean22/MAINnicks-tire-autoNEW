/**
 * Consolidation write side (audit 2026-10-10: 05-M4, 05-M7, 05-M16, 08-F8).
 *
 *  · M7  the merge keeper's content is rewritten; its embedding must follow,
 *        or vector recall keeps finding the OLD text.
 *  · M4  rows the merge soft-deletes carry the grinder stamp, so the
 *        conversation compiler can tell them from an operator delete.
 *  · F8  KV rows (`crons` first-seen registry, `cron_control` kill switches,
 *        `proactive_push_sent` dedup markers) are read by key, never merged.
 *  · M16 crossPollinate labelled Contradiction ids as `memory` nodes and
 *        re-added +0.1 strength every night for the same heuristic match.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  brainMemory: { groupBy: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  memoryEdge: { createMany: vi.fn(), update: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
  contradiction: { findMany: vi.fn() },
  prediction: { findMany: vi.fn() },
  reflection: { findMany: vi.fn() },
  $transaction: vi.fn(),
  aiChat: vi.fn(),
  storeMemoryEmbedding: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: m.brainMemory,
    memoryEdge: m.memoryEdge,
    contradiction: m.contradiction,
    prediction: m.prediction,
    reflection: m.reflection,
    $transaction: m.$transaction,
  },
}));
vi.mock("@/lib/ai/traced-aichat", () => ({ makeTracedAiChat: () => m.aiChat }));
vi.mock("@/lib/errors/record-error", () => ({ recordError: vi.fn() }));
vi.mock("@/lib/brain/embedding-utils", () => ({ storeMemoryEmbedding: m.storeMemoryEmbedding }));

import { crossPollinate, mergeMemories } from "@/lib/brain/memory-consolidation";
import { grinderDeleted } from "@/lib/brain/conversation-memory";

const ROWS = [
  { id: "keep", key: "k0", content: "likes early mornings", confidence: 0.9, seenCount: 2, metadata: { origin: "x" } },
  { id: "dup1", key: "k1", content: "wakes at 5", confidence: 0.6, seenCount: 1, metadata: null },
  { id: "o2", key: "k2", content: "other", confidence: 0.5, seenCount: 1, metadata: null },
  { id: "o3", key: "k3", content: "other 2", confidence: 0.4, seenCount: 1, metadata: null },
];
const MERGED = "Nour is a morning person: up at 5, best work before 9.";

beforeEach(() => {
  vi.clearAllMocks();
  m.brainMemory.groupBy.mockResolvedValue([{ category: "preference", _count: { id: 4 } }]);
  m.brainMemory.findMany.mockResolvedValue(ROWS);
  m.brainMemory.update.mockImplementation(async (a: unknown) => a);
  m.$transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
  m.aiChat.mockResolvedValue({ content: JSON.stringify([{ indices: [0, 1], merged: MERGED }]), provider: "ollama" });
  m.storeMemoryEmbedding.mockResolvedValue(undefined);
});

type UpdateArgs = { where: { id: string }; data: Record<string, unknown> };
const updates = () => m.brainMemory.update.mock.calls.map((c) => c[0] as UpdateArgs);

describe("mergeMemories · keeper and merged-away rows", () => {
  it("POSITIVE CONTROL: the fixture reaches a merge (keeper rewritten, one row soft-deleted)", async () => {
    await expect(mergeMemories()).resolves.toEqual({ merged: 1 });
    expect(updates().find((u) => u.where.id === "keep")?.data.content).toBe(MERGED);
  });

  it("re-embeds the rewritten keeper with the merged content (05-M7)", async () => {
    await mergeMemories();
    expect(m.storeMemoryEmbedding).toHaveBeenCalledTimes(1);
    expect(m.storeMemoryEmbedding).toHaveBeenCalledWith("keep", expect.stringContaining(MERGED));
  });

  it("stamps the merged-away row as a grinder delete, keeping its prior metadata (05-M4)", async () => {
    await mergeMemories();
    const del = updates().find((u) => u.where.id === "dup1")!;
    expect(del.data.deletedAt).toBeInstanceOf(Date);
    expect(grinderDeleted({ deletedAt: del.data.deletedAt as Date, metadata: del.data.metadata })).toBe(true);
    // the keeper is never stamped
    expect(updates().find((u) => u.where.id === "keep")?.data).not.toHaveProperty("deletedAt");
  });

  it("a failed merge transaction neither re-embeds nor counts as merged", async () => {
    m.$transaction.mockRejectedValue(new Error("deadlock"));
    await expect(mergeMemories()).resolves.toEqual({ merged: 0 });
    expect(m.storeMemoryEmbedding).not.toHaveBeenCalled();
  });

  it("never offers KV categories to the merge (08-F8)", async () => {
    m.brainMemory.groupBy.mockResolvedValue([]);
    await mergeMemories();
    const notIn: string[] = m.brainMemory.groupBy.mock.calls[0][0].where.category.notIn;
    expect(notIn).toEqual(expect.arrayContaining(["crons", "cron_control", "proactive_push_sent"]));
    // the shared list still reaches the query
    expect(notIn).toContain("conversation_summary");
  });
});

describe("crossPollinate · graph edges (05-M16)", () => {
  beforeEach(() => {
    m.brainMemory.findMany.mockResolvedValue([{ id: "w1", content: "Raising prices loses the regulars" }]);
    m.contradiction.findMany.mockResolvedValue([
      { id: "c1", claim: "Raising prices loses the regulars", gap: "they stayed after the $5 bump" },
    ]);
    m.prediction.findMany.mockResolvedValue([]);
    m.reflection.findMany.mockResolvedValue([]);
    m.memoryEdge.createMany.mockResolvedValue({ count: 1 });
  });

  it("labels the Contradiction end as a contradiction, not a memory", async () => {
    await crossPollinate();
    const data = m.memoryEdge.createMany.mock.calls[0][0].data as Array<Record<string, unknown>>;
    expect(data).toEqual([
      expect.objectContaining({
        sourceType: "memory",
        sourceId: "w1",
        targetType: "contradiction",
        targetId: "c1",
        relationship: "contradicts",
      }),
    ]);
  });

  it("a re-run of the same heuristic match adds no strength: create-only, duplicates skipped", async () => {
    m.memoryEdge.createMany.mockResolvedValue({ count: 0 }); // edge already exists
    await expect(crossPollinate()).resolves.toEqual({ connections: 0 });
    expect(m.memoryEdge.createMany.mock.calls[0][0].skipDuplicates).toBe(true);
    expect(m.memoryEdge.update).not.toHaveBeenCalled();
  });
});
