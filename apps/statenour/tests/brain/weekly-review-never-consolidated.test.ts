/**
 * Weekly reviews are per-week records, never merged or swept (R2a manager round 1, 2026-11-03).
 *
 * Prod read 2026-11-03 20:08Z (manager, counts only): category weekly_review had 22 cron rows
 * soft-deleted and 3 live. weekly:2026-09-28 was written 10-05 03:03Z and gone 03:16Z the same
 * night; three more went together 10-16 03:08Z, inside the nightly merge window (03:00-04:15Z until
 * 2026-11-01). mergeMemories soft-deletes every non-keeper of a merge group in any category NOT in
 * CONSOLIDATION_EXCLUDE_CATEGORIES (memory-consolidation.ts:70-212), and rewrites the keeper's content
 * into merged prose. This drives the REAL entry points with four weekly_review rows.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  brainMemory: { groupBy: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn(),
  aiChat: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { brainMemory: m.brainMemory, $transaction: m.$transaction } }));
vi.mock("@/lib/ai/traced-aichat", () => ({ makeTracedAiChat: () => m.aiChat }));
vi.mock("@/lib/errors/record-error", () => ({ recordError: vi.fn() }));
vi.mock("@/lib/brain/embedding-utils", () => ({ storeMemoryEmbedding: vi.fn().mockResolvedValue(undefined) }));

import { mergeMemories } from "@/lib/brain/memory-consolidation";

const REVIEWS = [
  { id: "w4", key: "weekly:2026-11-02", content: "WINS: shipped the goals tab", confidence: 0.95, seenCount: 1, metadata: { weekStart: "2026-11-02" } },
  { id: "w3", key: "weekly:2026-10-26", content: "WINS: calls reels", confidence: 0.95, seenCount: 1, metadata: { weekStart: "2026-10-26" } },
  { id: "w2", key: "weekly:2026-10-19", content: "WINS: camera lane", confidence: 0.95, seenCount: 1, metadata: { weekStart: "2026-10-19" } },
  { id: "w1", key: "weekly:2026-10-12", content: "WINS: bug hunt", confidence: 0.95, seenCount: 1, metadata: { weekStart: "2026-10-12" } },
];

beforeEach(() => {
  vi.clearAllMocks();
  // A groupBy that honours the exclude list, as Postgres does: weekly_review comes back only when it is not excluded.
  m.brainMemory.groupBy.mockImplementation(async (a: { where: { category: { notIn: string[] } } }) =>
    a.where.category.notIn.includes("weekly_review") ? [] : [{ category: "weekly_review", _count: { id: 4 } }]);
  m.brainMemory.findMany.mockResolvedValue(REVIEWS);
  m.brainMemory.update.mockImplementation(async (a: unknown) => a);
  m.brainMemory.updateMany.mockResolvedValue({ count: 0 });
  m.$transaction.mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops));
  // The model proposes merging all four weeks into one "pattern": the corruption the prod read shows.
  m.aiChat.mockResolvedValue({ content: JSON.stringify([{ indices: [0, 1, 2, 3], merged: "Nour ships every week." }]), provider: "ollama" });
});

describe("weekly_review rows survive the nightly consolidation", () => {
  it("a fresh review plus three older ones: nothing rewritten, nothing soft-deleted", async () => {
    await expect(mergeMemories()).resolves.toEqual({ merged: 0 });
    expect(m.brainMemory.update).not.toHaveBeenCalled();
    expect(m.aiChat).not.toHaveBeenCalled();
  });

  it("POSITIVE CONTROL: a mergeable category with the same rows IS merged (the fixture reaches the merge)", async () => {
    m.brainMemory.groupBy.mockResolvedValue([{ category: "preference", _count: { id: 4 } }]);
    await expect(mergeMemories()).resolves.toEqual({ merged: 3 });
  });
});
